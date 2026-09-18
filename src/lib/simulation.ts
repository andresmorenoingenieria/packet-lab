import { edges, edgesById, nodes } from './network';
import { createPackets, MESSAGE, PACKET_COUNT } from './packets';
import { nextHop } from './routing';
import {
  HOST_A,
  HOST_B,
  LATENCY_SCALE_MS,
  THROUGHPUT_SCALE,
  type CongestionLevel,
  type EventKind,
  type LossMark,
  type Packet,
  type RouterRuntime,
  type RoutingMode,
  type SimEvent,
  type SimPhase,
  type SimStats,
  type SimulationConfig,
  type SpeedMultiplier,
} from './types';

const EDGE_SPEED: Record<CongestionLevel, number> = { low: 96, medium: 64, high: 42 };
const PROC_TIME: Record<CongestionLevel, number> = { low: 0.32, medium: 0.5, high: 0.74 };
const SPAWN_STAGGER: Record<CongestionLevel, number> = { low: 0.5, medium: 0.62, high: 0.82 };
const CONGESTION_PROB: Record<CongestionLevel, number> = { low: 0, medium: 0.22, high: 0.45 };
const CONGESTED_EDGE_CAP = 3;
const LOSS_LIFETIME = 1.2;

export interface Reassembly {
  received: boolean[];
  complete: boolean;
}

export interface Snapshot {
  phase: SimPhase;
  running: boolean;
  clock: number;
  config: SimulationConfig;
  packets: readonly Packet[];
  routers: ReadonlyMap<string, RouterRuntime>;
  stats: SimStats;
  events: readonly SimEvent[];
  losses: readonly LossMark[];
  edgeLoad: ReadonlyMap<string, number>;
  congestedEdges: ReadonlySet<string>;
  reassembly: Reassembly;
  message: string;
  totalPackets: number;
}

export class SimulationEngine {
  private phase: SimPhase = 'ready';
  private clock = 0;
  private packets: Packet[] = [];
  private routers = new Map<string, RouterRuntime>();
  private config: SimulationConfig = {
    speed: 1,
    lossPercent: 0,
    congestion: 'low',
    routing: 'shortest',
  };
  private events: SimEvent[] = [];
  private losses: LossMark[] = [];
  private edgeLoad = new Map<string, number>();
  private congestedEdges = new Map<string, number>();
  private congestionTimer = 0;
  private eventSeq = 1;
  private lossSeq = 1;

  private onEventCb: ((e: SimEvent) => void) | null = null;
  private onPhaseCb: ((p: SimPhase) => void) | null = null;

  constructor() {
    for (const n of nodes) {
      if (n.kind === 'host') continue;
      this.routers.set(n.id, {
        nodeId: n.id,
        processed: 0,
        queueLength: 0,
        latencySum: 0,
        hops: 0,
      });
    }
    for (const e of edges) this.edgeLoad.set(e.id, 0);
    this.reset();
  }

  onEvent(cb: (e: SimEvent) => void): void {
    this.onEventCb = cb;
  }

  onPhase(cb: (p: SimPhase) => void): void {
    this.onPhaseCb = cb;
  }

  getPhase(): SimPhase {
    return this.phase;
  }

  snapshot(): Snapshot {
    return {
      phase: this.phase,
      running: this.phase === 'running',
      clock: this.clock,
      config: { ...this.config },
      packets: this.packets,
      routers: this.routers,
      stats: this.computeStats(),
      events: this.events,
      losses: this.losses,
      edgeLoad: this.edgeLoad,
      congestedEdges: new Set(this.congestedEdges.keys()),
      reassembly: this.computeReassembly(),
      message: MESSAGE,
      totalPackets: PACKET_COUNT,
    };
  }

  reset(): void {
    this.phase = 'ready';
    this.clock = 0;
    const stagger = SPAWN_STAGGER[this.config.congestion];
    this.packets = createPackets();
    this.packets.forEach((p, i) => {
      p.spawnTime = i * stagger;
      p.state = 'queued';
      p.atNode = HOST_A;
      p.linkId = null;
      p.progress = 0;
      p.queueRemaining = i * stagger;
      p.deliverTime = null;
      p.lossX = null;
      p.lossY = null;
      p.visited = [HOST_A];
    });
    this.eventSeq = 1;
    this.events = [];
    this.losses = [];
    this.congestedEdges = new Map();
    this.congestionTimer = 0;
    for (const e of edges) this.edgeLoad.set(e.id, 0);
    for (const r of this.routers.values()) {
      r.processed = 0;
      r.queueLength = 0;
      r.latencySum = 0;
      r.hops = 0;
    }
    this.pushEvent('info', 'Network ready. Press Start.');
    this.notifyPhase();
  }

  start(): void {
    if (this.phase === 'running' || this.phase === 'completed') return;
    if (this.phase === 'ready') {
      this.phase = 'running';
      this.pushEvent('info', 'Transmission started from Host A.');
    } else if (this.phase === 'paused') {
      this.phase = 'running';
      this.pushEvent('info', 'Simulation resumed.');
    }
    this.notifyPhase();
  }

  pause(): void {
    if (this.phase !== 'running') return;
    this.phase = 'paused';
    this.pushEvent('info', 'Simulation paused.');
    this.notifyPhase();
  }

  toggle(): void {
    if (this.phase === 'running') this.pause();
    else if (this.phase === 'paused' || this.phase === 'ready') this.start();
    else if (this.phase === 'completed') {
      this.reset();
      this.start();
    }
  }

  setSpeed(s: SpeedMultiplier): void {
    this.config.speed = s;
    this.pushEvent('info', `Transmission speed set to ${s}×.`);
  }

  setLoss(percent: number): void {
    this.config.lossPercent = Math.max(0, Math.min(30, Math.round(percent)));
    this.pushEvent('info', `Packet loss probability set to ${this.config.lossPercent}%.`);
  }

  setCongestion(level: CongestionLevel): void {
    this.config.congestion = level;
    this.pushEvent(
      'info',
      `Network congestion set to ${level === 'low' ? 'Low' : level === 'medium' ? 'Medium' : 'High'}.`,
    );
    if (level === 'low') this.congestedEdges.clear();
  }

  setRouting(mode: RoutingMode): void {
    this.config.routing = mode;
    if (mode === 'shortest') this.pushEvent('info', 'Routing policy: Shortest Path.');
    else if (mode === 'balanced') this.pushEvent('info', 'Routing policy: Load Balanced.');
    else this.pushEvent('info', 'Routing policy: Random.');
  }

  tick(dt: number): void {
    if (this.phase !== 'running') return;
    this.clock += dt;
    this.updateCongestion(dt);
    this.spawnPackets(dt);
    this.moveTransit(dt);
    this.processQueues(dt);
    this.expireLossMarks();
    this.syncQueueLengths();
    this.checkCompletion();
  }

  private spawnPackets(dt: number): void {
    for (const p of this.packets) {
      if (p.state !== 'queued' || p.atNode !== HOST_A) continue;
      p.queueRemaining -= dt;
      if (p.queueRemaining > 0) continue;
      const choice = this.pickRoute(p);
      if (this.shouldDrop()) {
        this.dropPacket(p, this.edgeMidpoint(choice.edgeId));
        continue;
      }
      this.launch(p, choice);
    }
  }

  private processQueues(dt: number): void {
    for (const p of this.packets) {
      if (p.state !== 'queued' || p.atNode === HOST_A) continue;
      p.queueRemaining -= dt;
      if (p.queueRemaining > 0) continue;
      const choice = this.pickRoute(p);
      if (this.shouldDrop()) {
        this.dropPacket(p, this.edgeMidpoint(choice.edgeId));
        continue;
      }
      this.launch(p, choice);
    }
  }

  private moveTransit(dt: number): void {
    for (const p of this.packets) {
      if (p.state !== 'transit' || !p.linkId) continue;
      p.progress += (dt / p.hopDuration) * this.config.speed;
      if (p.progress >= 1) this.arrive(p);
    }
  }

  private arrive(p: Packet): void {
    const geom = p.linkId ? edgesById.get(p.linkId) : undefined;
    const target = geom ? geom.to : null;
    if (!target || !p.linkId) return;
    this.setEdgeLoad(p.linkId, -1);
    p.linkId = null;
    p.progress = 0;
    p.visited.push(target);
    if (target === HOST_B) {
      this.deliver(p);
      return;
    }
    const rt = this.routers.get(target);
    if (rt) {
      rt.processed++;
      const proc = this.procTime();
      rt.latencySum += p.hopDuration + proc;
      rt.hops++;
    }
    p.state = 'queued';
    p.atNode = target;
    p.queueRemaining = this.procTime() * (0.7 + Math.random() * 0.6);
    this.pushEvent('hop', `Packet #${String(p.id).padStart(2, '0')} → Router ${target.slice(-1)}`);
  }

  private pickRoute(p: Packet) {
    return nextHop(this.config.routing, p.atNode, new Set(p.visited), (e) => this.edgeLoad.get(e) ?? 0);
  }

  private launch(p: Packet, choice: { next: string | null; edgeId: string | null }): void {
    const { next, edgeId } = choice;
    if (!next || !edgeId && !p.linkId) {
      this.dropPacket(p, null);
      return;
    }
    if (!edgeId) return;
    const geom = edgesById.get(edgeId);
    if (!geom) return;
    p.state = 'transit';
    p.atNode = '';
    p.linkId = edgeId;
    p.progress = 0;
    p.hopDuration = this.hopTime(geom.length, this.isEdgeCongested(edgeId));
    this.setEdgeLoad(edgeId, 1);
    this.pushEvent('hop', `Packet #${String(p.id).padStart(2, '0')} → ${next === HOST_B ? 'Host B' : `Router ${next.slice(-1)}`}`);
  }

  private deliver(p: Packet): void {
    p.state = 'delivered';
    p.deliverTime = this.clock;
    this.pushEvent('deliver', `Packet #${String(p.id).padStart(2, '0')} delivered.`);
  }

  private dropPacket(p: Packet, midpoint: { x: number; y: number } | null): void {
    p.state = 'lost';
    p.linkId = null;
    p.progress = 0;
    p.lossX = midpoint?.x ?? null;
    p.lossY = midpoint?.y ?? null;
    this.losses.push({
      id: this.lossSeq++,
      x: p.lossX ?? 0,
      y: p.lossY ?? 0,
      bornAt: this.clock,
    });
    this.pushEvent('loss', `Packet #${String(p.id).padStart(2, '0')} LOST — dropped.`);
  }

  private shouldDrop(): boolean {
    return this.config.lossPercent > 0 && Math.random() * 100 < this.config.lossPercent;
  }

  private checkCompletion(): void {
    const remaining = this.packets.some(
      (p) => p.state !== 'delivered' && p.state !== 'lost',
    );
    if (remaining || this.phase !== 'running') return;
    this.phase = 'completed';
    const delivered = this.packets.filter((p) => p.state === 'delivered').length;
    this.pushEvent(
      'info',
      delivered === this.packets.length
        ? 'Message reassembled — all packets delivered.'
        : `Transmission finished — ${this.packets.length - delivered} packet(s) lost.`,
    );
    this.notifyPhase();
  }

  private updateCongestion(dt: number): void {
    const prob = CONGESTION_PROB[this.config.congestion];
    if (this.config.congestion !== 'low') {
      this.congestionTimer += dt;
      if (this.congestionTimer >= 1) {
        this.congestionTimer = 0;
        this.retireExpiredCongestion();
        if (this.congestedEdges.size < CONGESTED_EDGE_CAP) {
          const open = edges.filter((e) => !this.congestedEdges.has(e.id));
          for (const e of open) {
            if (Math.random() < prob) {
              this.congestedEdges.set(e.id, this.clock + 1.1 + Math.random() * 1.4);
              if (this.congestedEdges.size >= CONGESTED_EDGE_CAP) break;
            }
          }
        }
      }
    } else {
      this.congestedEdges.clear();
    }
    this.retireExpiredCongestion();
  }

  private retireExpiredCongestion(): void {
    for (const [id, until] of this.congestedEdges) {
      if (until <= this.clock) this.congestedEdges.delete(id);
    }
  }

  private expireLossMarks(): void {
    const cutoff = this.clock - LOSS_LIFETIME;
    this.losses = this.losses.filter((l) => l.bornAt > cutoff);
  }

  private syncQueueLengths(): void {
    for (const rt of this.routers.values()) {
      rt.queueLength = 0;
    }
    for (const p of this.packets) {
      if (p.state === 'queued') {
        const rt = this.routers.get(p.atNode);
        if (rt) rt.queueLength++;
      }
    }
  }

  private setEdgeLoad(edgeId: string, delta: number): void {
    this.edgeLoad.set(edgeId, Math.max(0, (this.edgeLoad.get(edgeId) ?? 0) + delta));
  }

  private edgeMidpoint(edgeId: string | null): { x: number; y: number } | null {
    if (!edgeId) return null;
    const g = edgesById.get(edgeId);
    return g ? { x: g.midX, y: g.midY } : null;
  }

  private hopTime(length: number, congested: boolean): number {
    const speedFactor =
      this.config.congestion === 'high' ? 1.4 : this.config.congestion === 'medium' ? 1.18 : 1;
    const base = length / EDGE_SPEED[this.config.congestion];
    const jitter = 0.92 + Math.random() * 0.16;
    const hot = congested ? 1.75 : 1;
    return base * speedFactor * jitter * hot;
  }

  private procTime(): number {
    return PROC_TIME[this.config.congestion] * (0.8 + Math.random() * 0.4);
  }

  private isEdgeCongested(edgeId: string): boolean {
    return (this.congestedEdges.get(edgeId) ?? 0) > this.clock;
  }

  private computeStats(): SimStats {
    let delivered = 0;
    let lost = 0;
    let inTransit = 0;
    let queued = 0;
    let deliveredBytes = 0;
    let latencySum = 0;
    for (const p of this.packets) {
      switch (p.state) {
        case 'transit':
          inTransit++;
          break;
        case 'queued':
          queued++;
          break;
        case 'delivered':
          delivered++;
          deliveredBytes += p.sizeBytes;
          if (p.deliverTime !== null) {
            latencySum += (p.deliverTime - p.spawnTime) * LATENCY_SCALE_MS;
          }
          break;
        case 'lost':
          lost++;
          break;
      }
    }
    const span = Math.max(this.clock, 1e-6);
    return {
      total: PACKET_COUNT,
      inTransit,
      queued,
      delivered,
      lost,
      avgLatencyMs: delivered ? Math.round(latencySum / delivered) : 0,
      throughputMbps: (deliveredBytes * 8 * THROUGHPUT_SCALE) / span / 1_000_000,
      deliveredBytes,
    };
  }

  private computeReassembly(): Reassembly {
    const received = this.packets.map((p) => p.state === 'delivered');
    return {
      received,
      complete: received.every(Boolean) && received.length === PACKET_COUNT,
    };
  }

  private pushEvent(kind: EventKind, text: string): void {
    const ev: SimEvent = { id: this.eventSeq++, simTime: this.clock, text, kind };
    this.events.push(ev);
    if (this.events.length > 60) this.events.shift();
    this.onEventCb?.(ev);
  }

  private notifyPhase(): void {
    this.onPhaseCb?.(this.phase);
  }
}