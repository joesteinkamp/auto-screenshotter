/**
 * Heuristic scoring for discovered links.
 *
 * Signals combined (additively):
 *   - URL pathname patterns (patterns.ts)
 *   - Query-string patterns
 *   - Anchor text patterns
 *   - DOM context (nav/header/footer/CTA placement)
 *   - Depth penalty
 *
 * Output: ~-100 (skip) to ~+100 (must visit).
 */

import type { ExtractedLink, ScoredLink } from "../types";
import { hasSkippedExtension, isHttpUrl, sameOrigin } from "../lib/url";
import {
  ANCHOR_TEXT_PATTERNS,
  QUERY_PENALTY_PATTERNS,
  URL_PATTERNS,
} from "./patterns";

export interface ScoreOptions {
  sourceUrl: string;
  depth: number;
  sameOriginOnly: boolean;
  startUrl: string;
}

const HARD_SKIP = Number.NEGATIVE_INFINITY;

export function scoreLink(link: ExtractedLink, opts: ScoreOptions): number {
  // Hard skips
  if (!isHttpUrl(link.url)) return HARD_SKIP;
  if (hasSkippedExtension(link.url)) return HARD_SKIP;
  if (opts.sameOriginOnly && !sameOrigin(link.url, opts.startUrl)) return HARD_SKIP;

  let score = 0;
  let path = "/";
  let search = "";
  try {
    const u = new URL(link.url);
    path = u.pathname;
    search = u.search;
  } catch {
    return HARD_SKIP;
  }

  // URL pathname patterns — take the strongest match (by |score|)
  let urlMatch = 0;
  for (const rule of URL_PATTERNS) {
    if (rule.pattern.test(path) && Math.abs(rule.score) > Math.abs(urlMatch)) {
      urlMatch = rule.score;
    }
  }
  score += urlMatch;

  // Query-string penalties
  for (const rule of QUERY_PENALTY_PATTERNS) {
    if (rule.pattern.test(search)) score += rule.score;
  }

  // Anchor text — sum, capped per direction to prevent runaway
  const anchor = link.anchorText.toLowerCase().trim();
  let anchorPos = 0;
  let anchorNeg = 0;
  for (const rule of ANCHOR_TEXT_PATTERNS) {
    if (rule.pattern.test(anchor)) {
      if (rule.score > 0) anchorPos = Math.max(anchorPos, rule.score);
      else anchorNeg = Math.min(anchorNeg, rule.score);
    }
  }
  score += anchorPos + anchorNeg;

  // DOM context
  const ctx = link.context;
  if (ctx.inHeader) score += 15;
  if (ctx.inNav) score += 20;
  if (ctx.inFooter) score -= 25;
  if (ctx.isPrimaryCta) score += 25;
  if (ctx.ariaLabel && /main|primary|nav/i.test(ctx.ariaLabel)) score += 10;
  if (ctx.isHidden) score -= 40;
  if (ctx.fontSizePx > 0 && ctx.fontSizePx < 10) score -= 15;

  // Empty anchor text gets a small nudge down — usually decorative
  if (anchor.length === 0) score -= 5;

  // Depth penalty — past depth 1
  if (opts.depth > 1) score -= (opts.depth - 1) * 5;

  return score;
}

export function toScoredLink(link: ExtractedLink, opts: ScoreOptions): ScoredLink | null {
  const score = scoreLink(link, opts);
  if (score === HARD_SKIP || !Number.isFinite(score)) return null;
  return {
    url: link.url,
    score,
    depth: opts.depth,
    sourceUrl: opts.sourceUrl,
    anchorText: link.anchorText,
    context: link.context,
  };
}
