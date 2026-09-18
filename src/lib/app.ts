import { NetworkRenderer } from './render';
import { SimulationEngine } from './simulation';
import { nodeById } from './network';
import { LATENCY_SCALE_MS, type CongestionLevel, type RoutingMode, type SimPhase, type SpeedMultiplier } from './types';
import type { SimEvent } from './types';

function must<T extends Element>(sel: string): T {
  const n = document.querySelector<T>(sel);
  if (!n) throw new Error(`Missing element: ${sel}`);
  return n;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatClock(seconds: number): string {
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatMbps(v: number): string {
  return v.toFixed(2);
}

type Inspection =
  | { kind: 'host'; id: string }
  | { kind: 'router'; id: string }
  | { kind: 'packet'; seq: number }
  | null;

export class PacketLabApp {
  private sim = new SimulationEngine();
  private renderer: NetworkRenderer;
  private rafId = 0;
  private lastFrame = 0;
  private lastStatsKey = '';
  private inspection: Inspection = null;
  private reducedMotion = false;

  private readonly el = {
    svg: must<SVGSVGElement>('#network-svg'),
    graph: must<HTMLElement>('#network-graph'),
    hint: must<HTMLElement>('#graph-hint'),
    statusText: must<HTMLElement>('#status-text'),
    statusPill: must<HTMLElement>('#status-pill'),
    btnStart: must<HTMLButtonElement>('#btn-start'),
    btnStartLabel: must<HTMLElement>('#btn-start-label'),
    btnStartIcon: must<HTMLElement>('#btn-start-icon'),
    btnResetHeader: must<HTMLButtonElement>('#btn-reset-header'),
    btnReset: must<HTMLButtonElement>('#btn-reset'),
    lossSlider: must<HTMLInputElement>('#loss-slider'),
    lossValue: must<HTMLElement>('#loss-value'),
    statTotal: must<HTMLElement>('#stat-total'),
    statTransit: must<HTMLElement>('#stat-transit'),
    statQueued: must<HTMLElement>('#stat-queued'),
    statDelivered: must<HTMLElement>('#stat-delivered'),
    statLost: must<HTMLElement>('#stat-lost'),
    statLatency: must<HTMLElement>('#stat-latency'),
    statThroughput: must<HTMLElement>('#stat-throughput'),
    logList: must<HTMLElement>('#log-list'),
    inspector: must<HTMLElement>('#inspector'),
    inspectorTitle: must<HTMLElement>('#inspector-title'),
    inspectorRows: must<HTMLElement>('#inspector-rows'),
    inspectorClose: must<HTMLButtonElement>('#inspector-close'),
    infoOpen: must<HTMLButtonElement>('#info-open'),
    infoOverlay: must<HTMLElement>('#info-overlay'),
    infoClose: must<HTMLButtonElement>('#info-close'),
    speedButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('.speed-opt')),
    congestionButtons: Array.from(
      document.querySelectorAll<HTMLButtonElement>('.congestion-opt'),
    ),
    routingButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('.routing-opt')),
    tabButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-btn')),
    tabPanels: Array.from(document.querySelectorAll<HTMLElement>('.tab-panel')),
  };

  constructor() {
    this.renderer = new NetworkRenderer(this.el.svg, {
      onSelectNode: (id) => this.inspectNode(id),
      onSelectPacket: (seq) => this.inspectPacket(seq),
    });

    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.reducedMotion) document.documentElement.classList.add('reduced-motion');

    this.bindControls();
    this.bindInspector();
    this.bindInfoOverlay();
    this.sim.onEvent((e) => this.renderEvent(e));
    this.sim.onPhase((p) => this.handlePhase(p));

    this.handlePhase(this.sim.getPhase());
    this.setSegmented('speed');
    this.setSegmented('congestion');
    this.setSegmented('routing');
    this.syncStats();
    this.renderer.update(this.sim.snapshot());
  }

  private bindControls(): void {
    this.el.btnStart.addEventListener('click', () => {
      this.sim.toggle();
      this.ensureLoop();
    });
    const reset = (): void => {
      this.sim.reset();
      this.renderer.clearSelection();
      this.setInspection(null);
      this.ensureLoop();
    };
    this.el.btnReset.addEventListener('click', reset);
    this.el.btnResetHeader.addEventListener('click', reset);

    for (const btn of this.el.speedButtons) {
      btn.addEventListener('click', () => {
        const v = Number(btn.dataset.speed) as SpeedMultiplier;
        this.sim.setSpeed(v);
        this.setSegmented('speed');
      });
    }
    for (const btn of this.el.congestionButtons) {
      btn.addEventListener('click', () => {
        const level = btn.dataset.congestion as CongestionLevel;
        this.sim.setCongestion(level);
        this.setSegmented('congestion');
      });
    }
    for (const btn of this.el.routingButtons) {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.routing as RoutingMode;
        this.sim.setRouting(mode);
        this.setSegmented('routing');
      });
    }

    this.el.lossSlider.addEventListener('input', () => {
      const v = Number(this.el.lossSlider.value);
      this.el.lossValue.textContent = `${v}%`;
      this.sim.setLoss(v);
    });

    for (const tab of this.el.tabButtons) {
      tab.addEventListener('click', () => this.activateTab(tab.dataset.tab ?? 'control'));
    }
  }

  private bindInspector(): void {
    this.el.inspectorClose.addEventListener('click', () => this.setInspection(null));
    this.el.svg.addEventListener('click', (e) => {
      const t = e.target as Element;
      if (t === this.el.svg || t.classList.contains('net-bg')) this.setInspection(null);
    });
  }

  private bindInfoOverlay(): void {
    this.el.infoOpen.addEventListener('click', () => this.openInfo(true));
    this.el.infoClose.addEventListener('click', () => this.openInfo(false));
    this.el.infoOverlay.addEventListener('click', (e) => {
      if (e.target === this.el.infoOverlay) this.openInfo(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.openInfo(false);
        this.setInspection(null);
      }
    });
  }

  private openInfo(open: boolean): void {
    this.el.infoOverlay.hidden = !open;
    this.el.infoOpen.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const card = this.el.infoOverlay.querySelector('.info-card');
    card?.classList.remove('anim-riseslide');
    requestAnimationFrame(() => card?.classList.add('anim-riseslide'));
  }

  private handlePhase(phase: SimPhase): void {
    const text =
      phase === 'ready'
        ? 'Simulation Ready'
        : phase === 'running'
          ? 'Transmitting'
          : phase === 'paused'
            ? 'Paused'
            : 'Completed';
    this.el.statusText.textContent = text;
    this.el.statusPill.dataset.state = phase;

    const running = phase === 'running';
    const reply = phase === 'completed';
    this.el.btnStart.setAttribute('aria-pressed', running ? 'true' : 'false');
    this.el.btnStartLabel.textContent = running ? 'Pause' : reply ? 'Replay' : phase === 'paused' ? 'Resume' : 'Start';
    this.el.btnStartIcon.textContent = running ? 'Ⅱ' : '▶';
    if (reply) this.el.btnStartIcon.textContent = '↻';

    this.el.hint.classList.toggle('is-hidden', phase !== 'ready');
    document.documentElement.dataset.phase = phase;
    this.syncStats();
    this.renderer.update(this.sim.snapshot());
  }

  private setSegmented(kind: 'speed' | 'congestion' | 'routing'): void {
    const groups: Record<string, HTMLButtonElement[]> = {
      speed: this.el.speedButtons,
      congestion: this.el.congestionButtons,
      routing: this.el.routingButtons,
    };
    const key: Record<string, string> = {
      speed: String(this.sim.snapshot().config.speed),
      congestion: this.sim.snapshot().config.congestion,
      routing: this.sim.snapshot().config.routing,
    };
    for (const btn of groups[kind]) {
      const v = btn.dataset[kind === 'speed' ? 'speed' : kind === 'congestion' ? 'congestion' : 'routing'];
      btn.setAttribute('aria-pressed', v === key[kind] ? 'true' : 'false');
    }
  }

  private activateTab(name: string): void {
    for (const tab of this.el.tabButtons) {
      tab.setAttribute('aria-selected', tab.dataset.tab === name ? 'true' : 'false');
    }
    for (const panel of this.el.tabPanels) {
      panel.classList.toggle('is-active', panel.dataset.tab === name);
    }
  }

  private inspectNode(id: string): void {
    if (nodeById.get(id)?.kind === 'host') {
      this.setInspection({ kind: 'host', id });
      return;
    }
    this.setInspection({ kind: 'router', id });
  }

  private inspectPacket(seq: number): void {
    this.setInspection({ kind: 'packet', seq });
  }

  private setInspection(ins: Inspection): void {
    this.inspection = ins;
    const open = ins !== null;
    this.el.inspector.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (!open) {
      this.renderer.clearSelection();
      return;
    }
    if (ins.kind === 'packet') this.renderer.setSelection({ nodeId: null, packetId: ins.seq });
    else this.renderer.setSelection({ nodeId: ins.id, packetId: null });
    this.updateInspector(this.sim.snapshot());
  }

  private updateInspector(snap: ReturnType<SimulationEngine['snapshot']>): void {
    const ins = this.inspection;
    if (!ins) return;
    const rows: [string, string][] = [];
    let title = '';

    if (ins.kind === 'packet') {
      const p = snap.packets.find((pp) => pp.seq === ins.seq);
      if (!p) return;
      title = `PACKET #${String(p.seq).padStart(2, '0')}`;
      rows.push(
        ['Source', 'Host A'],
        ['Destination', 'Host B'],
        ['Sequence', `${pad(p.seq)} / ${pad(p.total)}`],
        ['Size', `${p.sizeBytes} B`],
        ['Current Node', this.currentNodeLabel(p)],
        ['Status', this.packetStatusLabel(p)],
      );
    } else if (ins.kind === 'router') {
      const rt = snap.routers.get(ins.id);
      const n = nodeById.get(ins.id);
      if (!n || !rt) return;
      title = `ROUTER ${String(ins.id.slice(-1)).toUpperCase()}`;
      const avgLatency = rt.hops > 0 ? (rt.latencySum / rt.hops) * LATENCY_SCALE_MS : 0;
      rows.push(
        ['Status', rt.queueLength >= 3 ? 'Congested' : 'Active'],
        ['Packets processed', String(rt.processed)],
        ['Queue', String(rt.queueLength)],
        ['Avg latency', `${avgLatency.toFixed(0)} ms`],
        ['Role', 'Forwarding node'],
      );
    } else {
      const n = nodeById.get(ins.id);
      if (!n) return;
      title = ins.id === 'host-a' ? 'HOST A' : 'HOST B';
      rows.push(
        ['Type', 'Endpoint host'],
        ['Kind', ins.id === 'host-a' ? 'Source (sender)' : 'Destination (receiver)'],
        ['Function', ins.id === 'host-a' ? 'Segments message into packets' : 'Reassembles message'],
      );
    }

    this.el.inspectorTitle.textContent = title;
    this.el.inspectorRows.replaceChildren(
      ...rows.map(([k, v]) => {
        const row = document.createElement('div');
        row.className = 'inspector-row';
        const kEl = document.createElement('dt');
        kEl.textContent = k;
        const vEl = document.createElement('dd');
        vEl.textContent = v;
        row.append(kEl, vEl);
        return row;
      }),
    );
  }

  private currentNodeLabel(p: ReturnType<SimulationEngine['snapshot']>['packets'][number]): string {
    if (p.state === 'transit') {
      const target = p.linkId ? p.linkId.replace(/^e-r\d+-/, '').replace(/^e-[ab]-/, '') : '';
      return `In transit (→ Router ${target})`;
    }
    if (p.state === 'queued') {
      return p.atNode === 'host-a' ? 'Host A' : `Router ${p.atNode.slice(-1)}`;
    }
    if (p.state === 'delivered') return 'Host B';
    return 'Lost';
  }

  private packetStatusLabel(p: ReturnType<SimulationEngine['snapshot']>['packets'][number]): string {
    switch (p.state) {
      case 'queued':
        return p.atNode === 'host-a' ? 'Waiting to send' : 'Queued / processing';
      case 'transit':
        return 'In Transit';
      case 'delivered':
        return 'Delivered';
      case 'lost':
        return 'Lost';
    }
  }

  private renderEvent(e: SimEvent): void {
    const row = document.createElement('li');
    row.className = `log-row log-${e.kind}`;
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = formatClock(e.simTime);
    const text = document.createElement('span');
    text.className = 'log-text';
    text.textContent = e.text;
    row.append(time, text);
    this.el.logList.prepend(row);
    while (this.el.logList.children.length > 40) {
      this.el.logList.lastElementChild?.remove();
    }
  }

  private syncStats(): void {
    const s = this.sim.snapshot().stats;
    const key = `${s.total}|${s.inTransit}|${s.queued}|${s.delivered}|${s.lost}|${s.avgLatencyMs}|${formatMbps(s.throughputMbps)}`;
    if (key === this.lastStatsKey) return;
    this.lastStatsKey = key;
    this.el.statTotal.textContent = String(s.total);
    this.el.statTransit.textContent = String(s.inTransit);
    this.el.statQueued.textContent = String(s.queued);
    this.el.statDelivered.textContent = String(s.delivered);
    this.el.statLost.textContent = String(s.lost);
    this.el.statLatency.textContent = `${s.avgLatencyMs} ms`;
    this.el.statThroughput.textContent = `${formatMbps(s.throughputMbps)} Mbps`;
  }

  private ensureLoop(): void {
    if (this.sim.getPhase() === 'running') {
      if (!this.rafId) {
        this.lastFrame = performance.now();
        this.rafId = requestAnimationFrame(this.loop);
      }
    }
  }

  private loop = (now: number): void => {
    this.rafId = 0;
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    this.sim.tick(dt);
    const snap = this.sim.snapshot();
    this.renderer.update(snap);
    this.syncStats();
    if (snap.phase === 'running') {
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }
    this.updateInspector(snap);
  };
}

function init(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new PacketLabApp(), { once: true });
  } else {
    new PacketLabApp();
  }
}

init();