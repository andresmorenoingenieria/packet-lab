export type NodeKind = 'host' | 'router';

export type SimPhase = 'ready' | 'running' | 'paused' | 'completed';

export type RoutingMode = 'shortest' | 'balanced' | 'random';

export type CongestionLevel = 'low' | 'medium' | 'high';

export type SpeedMultiplier = 0.5 | 1 | 2 | 4;

export type PacketState = 'queued' | 'transit' | 'delivered' | 'lost';

export type EventKind = 'spawn' | 'hop' | 'arrive' | 'deliver' | 'loss' | 'info';

export interface NetworkNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
}

export interface NetworkEdge {
  id: string;
  from: string;
  to: string;
}

export interface RouterRuntime {
  nodeId: string;
  processed: number;
  queueLength: number;
  /** rolling average of per-hop processing latencies, in sim-seconds */
  latencySum: number;
  hops: number;
}

export interface Packet {
  id: number;
  seq: number;
  total: number;
  sizeBytes: number;
  chunk: string;
  src: string;
  dst: string;
  state: PacketState;
  /** node id the packet currently occupies (Host A / a router queue) */
  atNode: string;
  /** edge being traversed when in transit */
  linkId: string | null;
  /** normalized progress across the edge, 0..1 */
  progress: number;
  /** remaining processing time in the current queue (sim-seconds) */
  queueRemaining: number;
  /** edge traversal duration for the current hop (sim-seconds) */
  hopDuration: number;
  /** ids of nodes already visited, in order */
  visited: string[];
  /** sim-time when the packet entered the network */
  spawnTime: number;
  /** sim-time when delivered */
  deliverTime: number | null;
  lossX: number | null;
  lossY: number | null;
}

export interface LossMark {
  id: number;
  x: number;
  y: number;
  bornAt: number;
}

export interface SimStats {
  total: number;
  inTransit: number;
  queued: number;
  delivered: number;
  lost: number;
  avgLatencyMs: number;
  throughputMbps: number;
  deliveredBytes: number;
}

export interface SimEvent {
  id: number;
  simTime: number;
  text: string;
  kind: EventKind;
}

export interface SimulationConfig {
  speed: SpeedMultiplier;
  lossPercent: number;
  congestion: CongestionLevel;
  routing: RoutingMode;
}

export const HOST_A = 'host-a';
export const HOST_B = 'host-b';
export const FIRST_ROUTER = 'router-1';

export const LATENCY_SCALE_MS = 10;
export const THROUGHPUT_SCALE = 100;