/**
 * Optional LLM-powered re-ranking. Uses Claude Haiku via the Anthropic
 * Messages API. If the call fails for any reason, callers should fall
 * back to pure heuristic scores.
 */

import type { ScoredLink } from "../types";

const MODEL = "claude-haiku-4-5-20251001";
const API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You rank URLs by how important they are for understanding a website's main product flow.

You will receive:
- A site URL and homepage title
- A list of candidate links with anchor text and a heuristic score

Your job: identify the pages that best represent the MAIN USER FLOW of the product (signup, login, dashboard, core features, pricing, checkout, settings). Deprioritize legal pages, blog posts, careers, help articles, and footer boilerplate.

Return ONLY a JSON array. Each entry:
  { "url": string, "score": number (-100 to 100), "reason": string (<=10 words) }

Score higher for pages in the primary product flow, lower for peripheral pages. Preserve the input URLs exactly.`;

interface RefinerResult {
  url: string;
  score: number;
  reason: string;
}

export interface RefineInput {
  siteUrl: string;
  homepageTitle: string;
  links: ScoredLink[];
  apiKey: string;
}

export async function refineWithLlm(input: RefineInput): Promise<RefinerResult[]> {
  const payload = {
    site_url: input.siteUrl,
    homepage_title: input.homepageTitle,
    candidates: input.links.map((l) => ({
      url: l.url,
      anchor: l.anchorText.slice(0, 80),
      heuristic_score: Math.round(l.score),
      in_nav: l.context.inNav || l.context.inHeader,
      in_footer: l.context.inFooter,
    })),
  };

  const resp = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
    }),
  });

  if (!resp.ok) {
    throw new Error(`LLM refiner HTTP ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const textBlock = data.content.find((b) => b.type === "text")?.text ?? "";
  const parsed = extractJsonArray(textBlock);
  if (!Array.isArray(parsed)) throw new Error("LLM did not return a JSON array");
  return parsed.filter(
    (e): e is RefinerResult =>
      e != null &&
      typeof e === "object" &&
      typeof (e as RefinerResult).url === "string" &&
      typeof (e as RefinerResult).score === "number",
  );
}

/**
 * Merge heuristic + LLM scores with a weighted average.
 * LLM gets 60% weight when available.
 */
export function mergeScores(heuristic: ScoredLink[], llm: RefinerResult[]): ScoredLink[] {
  const byUrl = new Map(llm.map((r) => [r.url, r]));
  return heuristic.map((link) => {
    const r = byUrl.get(link.url);
    if (!r) return link;
    const merged = Math.round(0.4 * link.score + 0.6 * r.score);
    return { ...link, score: merged };
  });
}

function extractJsonArray(text: string): unknown {
  // Claude sometimes wraps JSON in ```json fences; strip them.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}
