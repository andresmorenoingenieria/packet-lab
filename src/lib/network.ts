import type { NetworkEdge, NetworkNode } from './types';

const NODES: NetworkNode[] = [
  { id: 'host-a', kind: 'host', label: 'Host A', x: 70, y: 300 },
  { id: 'router-1', kind: 'router', label: 'R1', x: 235, y: 300 },
  { id: 'router-2', kind: 'router', label: 'R2', x: 415, y: 130 },
  { id: 'router-3', kind: 'router', label: 'R3', x: 415, y: 300 },
  { id: 'router-4', kind: 'router', label: 'R4', x: 415, y: 470 },
  { id: 'router-5', kind: 'router', label: 'R5', x: 615, y: 130 },
  { id: 'router-6', kind: 'router', label: 'R6', x: 615, y: 300 },
  { id: 'router-7', kind: 'router', label: 'R7', x: 615, y: 470 },
  { id: 'host-b', kind: 'host', label: 'Host B', x: 932, y: 300 },
];

const EDGES: NetworkEdge[] = [
  { id: 'e-a-r1', from: 'host-a', to: 'router-1' },
  { id: 'e-r1-r2', from: 'router-1', to: 'router-2' },
  { id: 'e-r1-r3', from: 'router-1', to: 'router-3' },
  { id: 'e-r1-r4', from: 'router-1', to: 'router-4' },
  { id: 'e-r2-r5', from: 'router-2', to: 'router-5' },
  { id: 'e-r2-r6', from: 'router-2', to: 'router-6' },
  { id: 'e-r3-r5', from: 'router-3', to: 'router-5' },
  { id: 'e-r3-r6', from: 'router-3', to: 'router-6' },
  { id: 'e-r4-r7', from: 'router-4', to: 'router-7' },
  { id: 'e-r5-r7', from: 'router-5', to: 'router-7' },
  { id: 'e-r6-b', from: 'router-6', to: 'host-b' },
  { id: 'e-r7-b', from: 'router-7', to: 'host-b' },
];

export interface EdgeGeometry {
  id: string;
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  midX: number;
  midY: number;
}

const nodeMap = new Map(NODES.map((n) => [n.id, n]));

function geometry(): Map<string, EdgeGeometry> {
  const out = new Map<string, EdgeGeometry>();
  for (const e of EDGES) {
    const a = nodeMap.get(e.from);
    const b = nodeMap.get(e.to);
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    out.set(e.id, {
      ...e,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      length: len,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    });
  }
  return out;
}

interface NbrTable {
  out: Map<string, NetworkEdge>;
  in: Map<string, NetworkEdge>;
}

function buildAdjacency(): Map<string, NbrTable> {
  const adj = new Map<string, NbrTable>();
  for (const id of nodeMap.keys()) adj.set(id, { out: new Map(), in: new Map() });
  for (const e of EDGES) {
    adj.get(e.from)!.out.set(e.id, e);
    adj.get(e.to)!.in.set(e.id, e);
  }
  return adj;
}

export const nodes = NODES;
export const edges = EDGES;
export const nodeById = nodeMap;
export const edgesById = geometry();
export const adjacency = buildAdjacency();

/** Undirected neighbors of a node (peer ids). */
export function neighbors(id: string): string[] {
  const t = adjacency.get(id);
  const out: string[] = [];
  if (!t) return out;
  for (const e of t.out.values()) out.push(e.to);
  for (const e of t.in.values()) out.push(e.from);
  return out;
}

/** BFS hop distance to the target node, computed once against a static graph. */
export function buildHopDistance(target: string): Map<string, number> {
  const dist = new Map<string, number>();
  dist.set(target, 0);
  const queue: string[] = [target];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    for (const n of neighbors(cur)) {
      if (!dist.has(n)) {
        dist.set(n, d + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}