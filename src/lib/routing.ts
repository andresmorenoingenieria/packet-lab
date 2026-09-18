import { adjacency, buildHopDistance, neighbors, nodeById } from './network';
import { HOST_B, type RoutingMode } from './types';

/**
 * Static distance table: hop distance from every node to the destination (Host B).
 * The network graph is static, so this is computed once at startup.
 */
const distToB = buildHopDistance(HOST_B);

/**
 * First hop toward B along a shortest path.
 * Derived from a BFS tree rooted at Host B: parent[v] is one neighbor of v that
 * lies on a shortest path from v to B.
 */
function buildShortestNext(): Map<string, string> {
  const next = new Map<string, string>();
  const parent = new Map<string, string>();
  const queue: string[] = [HOST_B];
  parent.set(HOST_B, HOST_B);
  while (queue.length) {
    const cur = queue.shift()!;
    const curDist = distToB.get(cur) ?? 0;
    for (const n of neighbors(cur)) {
      if (!parent.has(n)) {
        parent.set(n, cur);
        next.set(n, cur);
        if (curDist - 1 >= 0) queue.push(n);
      }
    }
  }
  return next;
}

const shortestNext = buildShortestNext();

interface RouteChoice {
  next: string | null;
  edgeId: string | null;
}

function edgeBetween(a: string, b: string): string | null {
  const t = adjacency.get(a);
  if (!t) return null;
  for (const e of t.out.values()) if (e.to === b) return e.id;
  for (const e of t.in.values()) if (e.from === b) return e.id;
  return null;
}

/**
 * Progressive candidates: unvisited neighbors whose hop distance to B does not
 * exceed the current node's distance. This keeps packets moving toward the
 * destination while still allowing alternative (equal-length) branches, and it
 * guarantees termination: each step either advances to B or consumes a new node.
 */
function candidates(from: string, visited: ReadonlySet<string>): string[] {
  const own = distToB.get(from) ?? Number.POSITIVE_INFINITY;
  const unvisited = neighbors(from).filter((n) => !visited.has(n));
  const reachable = unvisited.filter((n) => (distToB.get(n) ?? Infinity) <= own);
  if (reachable.length) return reachable;
  if (unvisited.length) return unvisited;
  return neighbors(from);
}

/**
 * Pick the next hop for a packet sitting at `from`.
 * The load callback reports how many packets currently occupy a given edge.
 */
export function nextHop(
  mode: RoutingMode,
  from: string,
  visited: ReadonlySet<string>,
  edgeLoad: (edgeId: string) => number,
): RouteChoice {
  const inGraph = nodeById.has(from);
  if (!inGraph) return { next: null, edgeId: null };

  if (mode === 'shortest') {
    const nxt = shortestNext.get(from);
    if (nxt) return { next: nxt, edgeId: edgeBetween(from, nxt) };
    const fallback = candidates(from, visited);
    if (fallback.length) {
      const nxt = fallback[0];
      return { next: nxt, edgeId: edgeBetween(from, nxt) };
    }
    return { next: null, edgeId: null };
  }

  const pool = candidates(from, visited);
  if (!pool.length) return { next: null, edgeId: null };

  const scored = pool.map((n) => {
    const eId = edgeBetween(from, n);
    const load = eId ? edgeLoad(eId) : Number.POSITIVE_INFINITY;
    return { n, eId, load, dist: distToB.get(n) ?? Infinity };
  });

  if (mode === 'balanced') {
    scored.sort((a, b) => a.load - b.load || a.dist - b.dist);
    const best = scored[0];
    return { next: best.n, edgeId: best.eId };
  }

  const pick = scored[Math.floor(Math.random() * scored.length)];
  return { next: pick.n, edgeId: pick.eId };
}