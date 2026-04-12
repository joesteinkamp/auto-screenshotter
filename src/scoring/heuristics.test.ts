import { describe, expect, it } from "vitest";
import { scoreLink } from "./heuristics";
import type { ExtractedLink } from "../types";

const baseCtx = {
  inHeader: false,
  inNav: false,
  inFooter: false,
  isPrimaryCta: false,
  isHidden: false,
  fontSizePx: 14,
  ariaLabel: null,
};

function link(url: string, anchorText = "", ctx: Partial<typeof baseCtx> = {}): ExtractedLink {
  return { url, anchorText, context: { ...baseCtx, ...ctx } };
}

const OPTS = {
  sourceUrl: "https://example.com/",
  depth: 1,
  sameOriginOnly: true,
  startUrl: "https://example.com/",
};

describe("scoreLink", () => {
  it("gives the homepage a high score", () => {
    expect(scoreLink(link("https://example.com/"), OPTS)).toBeGreaterThan(40);
  });

  it("scores /pricing and /signup highly", () => {
    expect(scoreLink(link("https://example.com/pricing", "Pricing"), OPTS)).toBeGreaterThan(40);
    expect(scoreLink(link("https://example.com/signup", "Sign up"), OPTS)).toBeGreaterThan(60);
  });

  it("penalizes privacy, terms, and cookie pages heavily", () => {
    expect(scoreLink(link("https://example.com/privacy", "Privacy"), OPTS)).toBeLessThan(-50);
    expect(scoreLink(link("https://example.com/terms", "Terms"), OPTS)).toBeLessThan(-50);
    expect(scoreLink(link("https://example.com/cookie-policy", "Cookies"), OPTS)).toBeLessThan(-50);
  });

  it("boosts nav placement and docks footer placement", () => {
    const navScore = scoreLink(link("https://example.com/features", "Features", { inNav: true }), OPTS);
    const footerScore = scoreLink(link("https://example.com/features", "Features", { inFooter: true }), OPTS);
    expect(navScore).toBeGreaterThan(footerScore);
  });

  it("rejects cross-origin links when sameOriginOnly is true", () => {
    const score = scoreLink(link("https://other.com/features"), OPTS);
    expect(score).toBe(Number.NEGATIVE_INFINITY);
  });

  it("rejects file-extension URLs", () => {
    expect(scoreLink(link("https://example.com/brochure.pdf"), OPTS)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("penalizes pagination query strings", () => {
    const plain = scoreLink(link("https://example.com/products", "Products"), OPTS);
    const paged = scoreLink(link("https://example.com/products?page=2", "Products"), OPTS);
    expect(paged).toBeLessThan(plain);
  });

  it("prefers primary CTAs over plain links with the same URL", () => {
    const plain = scoreLink(link("https://example.com/signup", "Sign up"), OPTS);
    const cta = scoreLink(link("https://example.com/signup", "Sign up", { isPrimaryCta: true }), OPTS);
    expect(cta).toBeGreaterThan(plain);
  });
});
