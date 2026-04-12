/**
 * Max-heap priority queue. Higher score = popped first.
 * Ties broken by lower `depth`, then FIFO insertion order.
 */

import type { ScoredLink } from "../types";

interface Entry {
  link: ScoredLink;
  seq: number;
}

export class PriorityQueue {
  private heap: Entry[] = [];
  private counter = 0;

  get size(): number {
    return this.heap.length;
  }

  push(link: ScoredLink): void {
    const entry: Entry = { link, seq: this.counter++ };
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): ScoredLink | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0].link;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  peek(): ScoredLink | undefined {
    return this.heap[0]?.link;
  }

  toArray(): ScoredLink[] {
    return this.heap.map((e) => e.link);
  }

  private compare(a: Entry, b: Entry): number {
    // Higher score first
    if (a.link.score !== b.link.score) return b.link.score - a.link.score;
    // Lower depth first
    if (a.link.depth !== b.link.depth) return a.link.depth - b.link.depth;
    // FIFO
    return a.seq - b.seq;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(this.heap[i], this.heap[parent]) < 0) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else break;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let best = i;
      if (l < n && this.compare(this.heap[l], this.heap[best]) < 0) best = l;
      if (r < n && this.compare(this.heap[r], this.heap[best]) < 0) best = r;
      if (best === i) break;
      [this.heap[i], this.heap[best]] = [this.heap[best], this.heap[i]];
      i = best;
    }
  }
}
