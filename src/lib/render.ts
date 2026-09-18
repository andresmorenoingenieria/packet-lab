import { edgesById, nodes, nodeById } from './network';
import { PACKET_COUNT } from './packets';
import { HOST_A, HOST_B } from './types';
import type { Snapshot } from './simulation';

const VB_W = 1000;
const VB_H = 620;

const CYAN = '#22d3ee';
const SLATE = '#475569';
const DIM = '#334155';

interface SelectionHandlers {
  onSelectNode: (id: string) => void;
  onSelectPacket: (seq: number, id: number) => void;
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | null> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  return node;
}

interface EdgeVisual {
  group: SVGGElement;
  base: SVGLineElement;
  glow: SVGLineElement;
  hot: SVGLineElement;
  loadLabel: SVGTextElement;
}

export interface RendererSelect {
  nodeId: string | null;
  packetId: number | null;
}

export class NetworkRenderer {
  private svg: SVGSVGElement;
  private edgeVisuals = new Map<string, EdgeVisual>();
  private nodeGroups = new Map<string, SVGGElement>();
  private queueBadges = new Map<string, SVGTextElement>();
  private packetEls = new Map<number, SVGGElement>();
  private fxLayer!: SVGGElement;
  private reassemblyEl!: SVGGElement;
  private messageEl!: SVGGElement;
  private reassemblyStatus!: SVGTextElement;
  private lastAssemblyKey = '';

  constructor(root: SVGSVGElement, handlers: SelectionHandlers) {
    this.svg = root;
    this.svg.setAttribute('viewBox', `0 0 ${VB_W} ${VB_H}`);
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', 'Packet switching network topology. Select a packet or router to inspect.');
    this.buildDefs();
    this.buildBackground();
    this.buildEdges();
    this.buildNodes(handlers);
    this.buildPackets(handlers);
    this.buildFx();
    this.updateTopologySummary();
  }

  setSelection(sel: RendererSelect): void {
    for (const g of this.nodeGroups.values()) {
      g.classList.toggle('is-selected', false);
    }
    if (sel.nodeId) this.nodeGroups.get(sel.nodeId)?.classList.add('is-selected');
    for (const g of this.packetEls.values()) {
      g.classList.toggle('is-selected', false);
    }
    if (sel.packetId !== null) this.packetEls.get(sel.packetId)?.classList.add('is-selected');
  }

  clearSelection(): void {
    this.setSelection({ nodeId: null, packetId: null });
  }

  update(snap: Snapshot): void {
    this.updateEdges(snap);
    this.updatePackets(snap);
    this.updateNodes(snap);
    this.updateLossFx(snap);
    this.updateReassembly(snap);
  }

  private buildDefs(): void {
    const defs = el('defs');
    const grid = el('pattern', { id: 'grid', width: 32, height: 32, patternUnits: 'userSpaceOnUse' });
    grid.appendChild(el('path', { d: 'M32 0H0V32', fill: 'none', stroke: '#16233b', 'stroke-width': 1 }));
    defs.appendChild(grid);
    const marker = el('marker', {
      id: 'arrow',
      viewBox: '0 0 10 10',
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: 'auto-start-reverse',
    });
    marker.appendChild(el('path', { d: 'M0 0L10 5L0 10Z', fill: DIM }));
    defs.appendChild(marker);
    this.svg.appendChild(defs);
  }

  private buildBackground(): void {
    this.svg.appendChild(
      el('rect', { x: 0, y: 0, width: VB_W, height: VB_H, fill: 'url(#grid)', class: 'net-bg' }),
    );
  }

  private buildEdges(): void {
    for (const g of edgesById.values()) {
      const group = el('g', { class: 'edge' });
      const base = el('line', {
        x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2,
        class: 'edge-base',
      });
      base.setAttribute('marker-start', 'url(#arrow)');
      base.setAttribute('marker-end', 'url(#arrow)');
      const glow = el('line', {
        x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2,
        class: 'edge-glow',
      });
      const hot = el('line', {
        x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2,
        class: 'edge-hot',
      });
      const loadLabel = el('text', {
        x: g.midX, y: g.midY - 8,
        'class': 'edge-load', 'text-anchor': 'middle', 'font-size': 11,
        fill: CYAN, 'font-family': 'ui-monospace, monospace',
      });
      group.appendChild(base);
      group.appendChild(hot);
      group.appendChild(glow);
      group.appendChild(loadLabel);
      this.svg.appendChild(group);
      this.edgeVisuals.set(g.id, { group, base, glow, hot, loadLabel });
    }
  }

  private buildNodes(handlers: SelectionHandlers): void {
    for (const n of nodes) {
      const group = el('g', { class: 'node', 'data-node': n.id });
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-label', `${n.label}: ${n.kind === 'host' ? 'host' : 'router'}. Press Enter to inspect.`);

      if (n.kind === 'host') {
        const color = n.id === HOST_A ? '#10b981' : '#c084fc';
        const groupEl = el('g', { transform: `translate(${n.x} ${n.y})` });
        const circle = el('circle', { r: 26, class: 'node-host', fill: '#0b1220', stroke: color, 'stroke-width': 2 });
        circle.appendChild(el('circle', { r: 4, fill: color }));
        groupEl.appendChild(circle);
        const label = el('text', {
          y: 42, 'text-anchor': 'middle', class: 'node-label-host', fill: color,
        });
        label.textContent = n.label;
        groupEl.appendChild(label);
        group.appendChild(groupEl);
      } else {
        const groupEl = el('g', { transform: `translate(${n.x} ${n.y})` });
        const rect = el('rect', {
          x: -23, y: -17, width: 46, height: 34, rx: 9,
          class: 'node-router', fill: '#16233b', stroke: SLATE, 'stroke-width': 1.6,
        });
        groupEl.appendChild(rect);
        for (const [dx, dy] of [
          [-23, -17], [23, -17], [-23, 17], [23, 17],
        ] as const) {
          groupEl.appendChild(
            el('circle', { cx: dx, cy: dy, r: 2.2, fill: DIM, class: 'node-port' }),
          );
        }
        const label = el('text', {
          y: 4.5, 'text-anchor': 'middle', class: 'node-label-router', fill: '#e2e8f0',
        });
        label.textContent = n.label;
        groupEl.appendChild(label);
        group.appendChild(groupEl);

        const badgeAnchor = el('g', { transform: `translate(${n.x} ${n.y})` });
        const badge = el('text', {
          x: 24, y: -20, 'text-anchor': 'middle', 'font-size': 10,
          fill: '#0f172a', 'font-family': 'ui-monospace, monospace',
          class: 'queue-badge', opacity: 0,
        });
        badge.textContent = '0';
        badgeAnchor.appendChild(badge);
        group.appendChild(badgeAnchor);
        this.queueBadges.set(n.id, badge);
      }

      const handler = (): void => handlers.onSelectNode(n.id);
      group.addEventListener('click', handler);
      group.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler();
        }
      });
      this.svg.appendChild(group);
      this.nodeGroups.set(n.id, group);
    }
  }

  private buildPackets(handlers: SelectionHandlers): void {
    for (let seq = 1; seq <= PACKET_COUNT; seq++) {
      const group = el('g', { class: 'packet', 'data-packet': String(seq), opacity: 0 });
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-label', `Packet ${String(seq).padStart(2, '0')}. Press Enter to inspect.`);
      const body = el('rect', { x: -9, y: -5, width: 18, height: 10, rx: 3, class: 'packet-body' });
      const tag = el('text', {
        x: 0, y: 2.5, 'text-anchor': 'middle', 'font-size': 7, fill: '#082f49',
        'font-family': 'ui-monospace, monospace', 'pointer-events': 'none',
      });
      tag.textContent = String(seq).padStart(2, '0');
      group.appendChild(body);
      group.appendChild(tag);
      const handler = (e: Event): void => {
        e.stopPropagation();
        handlers.onSelectPacket(seq, seq);
      };
      group.addEventListener('click', handler);
      group.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler(e);
        }
      });
      this.svg.appendChild(group);
      this.packetEls.set(seq, group);
    }
  }

  private buildFx(): void {
    this.fxLayer = el('g', { 'data-fx': '1' });
    this.svg.appendChild(this.fxLayer);
  }

  private updateTopologySummary(): void {
    const hostB = nodeById.get(HOST_B)!;
    const summary = el('g', { transform: `translate(${hostB.x} ${hostB.y - 130})`, class: 'net-summary' });
    const pill = el('rect', { x: -14, y: -18, width: 196, height: 40, rx: 8, fill: '#0b1220', stroke: '#1e293b' });
    const network = el('text', { x: 84, y: 2, 'text-anchor': 'middle', 'font-size': 11, fill: '#94a3b8', 'font-family': 'ui-monospace, monospace' });
    network.textContent = 'PACKET NETWORK';
    summary.appendChild(pill);
    summary.appendChild(network);
    this.svg.insertBefore(summary, this.fxLayer);
  }

  private buildReassemblyEl(): void {
    if (this.reassemblyEl) return;
    this.reassemblyEl = el('g', { transform: `translate(470 ${VB_H - 52})` });
    const bg = el('rect', { x: -18, y: -26, width: 470, height: 52, rx: 10, fill: '#0b1220', stroke: '#1e293b' });
    const title = el('text', { x: 0, y: -8, 'font-size': 10, fill: '#64748b', 'font-family': 'ui-monospace, monospace' });
    title.setAttribute('letter-spacing', '2');
    title.textContent = 'RECEIVED AT HOST B';
    const row = el('g', { transform: 'translate(0 10)' });
    this.reassemblyStatus = el('text', {
      x: 330, y: -8, 'font-size': 10, fill: '#64748b', 'font-family': 'ui-monospace, monospace',
    });
    this.reassemblyStatus.setAttribute('text-anchor', 'end');
    this.reassemblyEl.appendChild(bg);
    this.reassemblyEl.appendChild(title);
    this.reassemblyEl.appendChild(this.reassemblyStatus);
    this.reassemblyEl.appendChild(row);
    this.fxLayer.parentElement?.insertBefore(this.reassemblyEl, this.fxLayer);
  }

  private buildMessageEl(): void {
    if (this.messageEl) return;
    const hostA = nodeById.get(HOST_A)!;
    this.messageEl = el('g', { transform: `translate(${hostA.x} ${VB_H - 52})` });
    const bg = el('rect', { x: -18, y: -26, width: 292, height: 52, rx: 10, fill: '#0b1220', stroke: '#1e293b' });
    const title = el('text', { x: 0, y: -8, 'font-size': 10, fill: '#64748b', 'font-family': 'ui-monospace, monospace' });
    title.setAttribute('letter-spacing', '2');
    title.textContent = 'MESSAGE — SPLIT INTO 8 PACKETS';
    const body = el('text', { x: 0, y: 10, 'font-size': 12, fill: '#67e8f9', 'font-family': 'ui-monospace, monospace', class: 'msg-body' });
    this.messageEl.appendChild(bg);
    this.messageEl.appendChild(title);
    this.messageEl.appendChild(body);
    this.fxLayer.parentElement?.insertBefore(this.messageEl, this.fxLayer);
  }

  private updateEdges(snap: Snapshot): void {
    const active = new Set<string>();
    const load = new Map<string, number>();
    for (const p of snap.packets) {
      if (p.state === 'transit' && p.linkId) {
        active.add(p.linkId);
        load.set(p.linkId, (load.get(p.linkId) ?? 0) + 1);
      }
    }
    for (const [id, vis] of this.edgeVisuals) {
      const isActive = active.has(id) && snap.phase !== 'ready';
      const isHot = snap.congestedEdges.has(id) && snap.phase !== 'ready';
      vis.group.classList.toggle('is-active', isActive);
      vis.group.classList.toggle('is-hot', isHot);
      const count = load.get(id) ?? 0;
      const prev = vis.group.getAttribute('data-load') ?? '-1';
      const changed = count !== Number(prev);
      vis.group.setAttribute('data-load', String(count));
      if (changed) {
        vis.loadLabel.textContent = count > 0 ? String(count) : '';
        vis.loadLabel.setAttribute('opacity', count > 0 ? '1' : '0');
      }
    }
  }

  private updateNodes(snap: Snapshot): void {
    for (const [id, group] of this.nodeGroups) {
      if (!this.queueBadges.has(id)) continue;
      const rt = snap.routers.get(id);
      const q = rt?.queueLength ?? 0;
      const badge = this.queueBadges.get(id)!;
      const text = q > 0 ? String(q) : '0';
      if (badge.textContent !== text) badge.textContent = text;
      const visible = q > 0 && snap.phase !== 'ready';
      const targetOp = visible ? 1 : 0;
      badge.setAttribute('opacity', String(targetOp));
      group.classList.toggle('is-congested', (rt?.queueLength ?? 0) >= 3);
    }
  }

  private updatePackets(snap: Snapshot): void {
    for (const p of snap.packets) {
      const g = this.packetEls.get(p.seq);
      if (!g) continue;
      let x = 0;
      let y = 0;
      let visible = true;
      switch (p.state) {
        case 'transit': {
          if (p.linkId && p.hopDuration > 0) {
            const geom = edgesById.get(p.linkId);
            if (geom) {
              const t = Math.min(p.progress, 1);
              x = geom.x1 + (geom.x2 - geom.x1) * t;
              y = geom.y1 + (geom.y2 - geom.y1) * t;
              const dx = geom.x2 - geom.x1;
              const dy = geom.y2 - geom.y1;
              const len = Math.hypot(dx, dy) || 1;
              const lane = ((p.id % 3) - 1) * 6;
              x += (-dy / len) * lane;
              y += (dx / len) * lane;
            }
          }
          break;
        }
        case 'queued': {
          const n = nodeById.get(p.atNode);
          if (n) {
            if (n.id === 'host-a') {
              const col = (p.id - 1) % 4;
              const row = Math.floor((p.id - 1) / 4);
              x = n.x - 40 + col * 21;
              y = n.y - 50 + row * 20;
            } else {
              const k = p.id * 2.39996;
              const r = 27 + (p.id % 3) * 9;
              x = n.x + Math.cos(k) * r;
              y = n.y + Math.sin(k) * r - 10;
            }
          }
          break;
        }
        case 'delivered': {
          const n = nodeById.get(HOST_B)!;
          const col = (p.seq - 1) % 4;
          const row = Math.floor((p.seq - 1) / 4);
          x = n.x - 72 + col * 22;
          y = n.y - 50 + row * 22;
          break;
        }
        case 'lost':
          visible = false;
          break;
      }
      if (!visible) {
        g.setAttribute('opacity', '0');
        continue;
      }
      g.setAttribute('opacity', '1');
      g.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
    }
  }

  private updateLossFx(snap: Snapshot): void {
    const existing = new Map<number, SVGGElement>();
    for (const child of Array.from(this.fxLayer.children)) {
      if (!(child instanceof SVGGElement)) continue;
      const key = Number(child.getAttribute('data-loss') ?? '-1');
      existing.set(key, child);
    }
    const wanted = new Set<number>(snap.losses.map((l) => l.id));
    for (const [key, child] of existing) {
      if (!wanted.has(key)) child.remove();
    }
    for (const l of snap.losses) {
      if (existing.has(l.id)) continue;
      const burst = el('g', { transform: `translate(${l.x} ${l.y})`, class: 'loss-burst', 'data-loss': String(l.id), 'data-fx': '1' });
      const ring = el('circle', { r: 1 });
      const xMark = el('g', { class: 'loss-x' });
      xMark.appendChild(el('line', { x1: -6, y1: -6, x2: 6, y2: 6 }));
      xMark.appendChild(el('line', { x1: 6, y1: -6, x2: -6, y2: 6 }));
      ring.setAttribute('class', 'loss-ring');
      burst.appendChild(ring);
      burst.appendChild(xMark);
      this.fxLayer.appendChild(burst);
    }
  }

  private updateReassembly(snap: Snapshot): void {
    if (!this.reassemblyEl) this.buildReassemblyEl();
    if (!this.messageEl) this.buildMessageEl();
    const recv = snap.reassembly.received;
    const complete = snap.reassembly.complete;
    const key = `${recv.join('')}|${complete}|${snap.phase}`;
    if (key === this.lastAssemblyKey) return;
    this.lastAssemblyKey = key;

    const row = this.reassemblyEl.querySelector('g') as SVGGElement;
    while (row.firstChild) row.removeChild(row.firstChild);
    const total = snap.totalPackets;
    if (snap.phase === 'ready') {
      this.reassemblyStatus.textContent = 'WAITING';
      this.reassemblyStatus.setAttribute('fill', '#64748b');
    } else if (snap.phase === 'completed') {
      this.reassemblyStatus.textContent = complete ? '✓ REASSEMBLED' : '⚠ INCOMPLETE';
      this.reassemblyStatus.setAttribute('fill', complete ? '#2dd4bf' : '#fb7185');
    } else {
      const count = recv.filter(Boolean).length;
      this.reassemblyStatus.textContent = `${count}/${total}`;
      this.reassemblyStatus.setAttribute('fill', '#64748b');
    }
    let xCursor = 0;
    for (let i = 0; i < total; i++) {
      const isRecv = recv[i];
      const chip = el('g', { transform: `translate(${xCursor} 0)`, opacity: isRecv ? '1' : '0.3' });
      const r = el('rect', {
        width: 44, height: 18, rx: 5,
        fill: isRecv ? '#164e63' : '#0b1626',
        stroke: isRecv ? CYAN : '#1e293b',
      });
      const num = el('text', {
        x: 22, y: 12, 'text-anchor': 'middle', 'font-size': 9, fill: isRecv ? '#a5f3fc' : '#334155',
        'font-family': 'ui-monospace, monospace',
      });
      num.textContent = isRecv ? `#${String(i + 1).padStart(2, '0')}` : '···';
      chip.appendChild(r);
      chip.appendChild(num);
      row.appendChild(chip);
      xCursor += 48;
    }
    const bg = this.reassemblyEl.querySelector('rect')!;
    bg.setAttribute('stroke', complete ? CYAN : '#1e293b');
  }

  detach(): void {
    this.svg.onclick = null;
  }
}