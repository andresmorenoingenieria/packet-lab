import { HOST_A, HOST_B, type Packet } from './types';

export const MESSAGE = 'Hello! Packet switching works.';
export const PACKET_COUNT = 8;

export interface MessagePlan {
  chunks: string[];
  totalBytes: number;
}

function chunkMessage(text: string, count: number): string[] {
  const base = Math.ceil(text.length / count);
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + base));
    i += base;
  }
  return chunks;
}

export function planMessage(): MessagePlan {
  const chunks = chunkMessage(MESSAGE, PACKET_COUNT);
  return { chunks, totalBytes: MESSAGE.length };
}

export function createPackets(): Packet[] {
  const { chunks, totalBytes } = planMessage();
  const baseSize = Math.ceil(totalBytes / chunks.length);
  return chunks.map((chunk, i) => ({
    id: i + 1,
    seq: i + 1,
    total: chunks.length,
    sizeBytes: 512 + chunk.length + Math.floor(baseSize / 2),
    chunk,
    src: HOST_A,
    dst: HOST_B,
    state: 'queued',
    atNode: HOST_A,
    linkId: null,
    progress: 0,
    queueRemaining: (i % 4) * 0.05,
    hopDuration: 0,
    visited: [HOST_A],
    spawnTime: 0,
    deliverTime: null,
    lossX: null,
    lossY: null,
  }));
}