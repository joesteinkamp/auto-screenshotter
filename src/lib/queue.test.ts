import { describe, expect, it } from "vitest";
import { PriorityQueue } from "./queue";
import type { ScoredLink } from "../types";

const baseCtx = {
  inHeader: false,
  inNav: false,
  inFooter: false,
  isPrimaryCta: false,
  isHidden: false,
  fontSizePx: 14,
  ariaLabel: null,
};

function link(url: string, score: number, depth = 1): ScoredLink {
  return {
    url,
    score,
    depth,
    sourceUrl: "https://example.com",
    anchorText: url,
    context: baseCtx,
  };
}

describe("PriorityQueue", () => {
  it("pops highest score first", () => {
    const q = new PriorityQueue();
    q.push(link("a", 10));
    q.push(link("b", 50));
    q.push(link("c", 30));
    expect(q.pop()?.url).toBe("b");
    expect(q.pop()?.url).toBe("c");
    expect(q.pop()?.url).toBe("a");
    expect(q.pop()).toBeUndefined();
  });

  it("breaks ties by lower depth", () => {
    const q = new PriorityQueue();
    q.push(link("deep", 20, 3));
    q.push(link("shallow", 20, 1));
    expect(q.pop()?.url).toBe("shallow");
  });

  it("preserves FIFO order for full ties", () => {
    const q = new PriorityQueue();
    q.push(link("first", 10, 1));
    q.push(link("second", 10, 1));
    expect(q.pop()?.url).toBe("first");
    expect(q.pop()?.url).toBe("second");
  });

  it("reports size correctly", () => {
    const q = new PriorityQueue();
    expect(q.size).toBe(0);
    q.push(link("a", 1));
    q.push(link("b", 2));
    expect(q.size).toBe(2);
    q.pop();
    expect(q.size).toBe(1);
  });
});
