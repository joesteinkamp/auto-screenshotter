/**
 * Optional LLM-powered re-ranking. Supports multiple providers
 * (Anthropic, OpenAI, Google Gemini). If the call fails for any reason,
 * callers should fall back to pure heuristic scores.
 */

import type { AiProvider, ScoredLink } from "../types";

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
};

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
  provider: AiProvider;
  apiKey: string;
  /** Optional model override; falls back to DEFAULT_MODELS[provider]. */
  model?: string;
}

function buildUserPayload(input: RefineInput): string {
  return JSON.stringify({
    site_url: input.siteUrl,
    homepage_title: input.homepageTitle,
    candidates: input.links.map((l) => ({
      url: l.url,
      anchor: l.anchorText.slice(0, 80),
      heuristic_score: Math.round(l.score),
      in_nav: l.context.inNav || l.context.inHeader,
      in_footer: l.context.inFooter,
    })),
  });
}

export async function refineWithLlm(input: RefineInput): Promise<RefinerResult[]> {
  const model = input.model || DEFAULT_MODELS[input.provider];
  const userContent = buildUserPayload(input);

  let text: string;
  switch (input.provider) {
    case "anthropic":
      text = await callAnthropic(input.apiKey, model, userContent);
      break;
    case "openai":
      text = await callOpenAi(input.apiKey, model, userContent);
      break;
    case "gemini":
      text = await callGemini(input.apiKey, model, userContent);
      break;
    default: {
      const _exhaustive: never = input.provider;
      throw new Error(`Unknown AI provider: ${String(_exhaustive)}`);
    }
  }

  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) throw new Error("LLM did not return a JSON array");
  return parsed.filter(
    (e): e is RefinerResult =>
      e != null &&
      typeof e === "object" &&
      typeof (e as RefinerResult).url === "string" &&
      typeof (e as RefinerResult).score === "number",
  );
}

async function callAnthropic(apiKey: string, model: string, userContent: string): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Anthropic HTTP ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return data.content.find((b) => b.type === "text")?.text ?? "";
}

async function callOpenAi(apiKey: string, model: string, userContent: string): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI HTTP ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    choices: Array<{ message: { content: string | null } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

async function callGemini(apiKey: string, model: string, userContent: string): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Gemini HTTP ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
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
  // Models sometimes wrap JSON in ```json fences, or (with OpenAI's
  // json_object response format) return an object that contains the array.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start !== -1 && end !== -1) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      // fall through
    }
  }
  // Try parsing as an object and pulling out the first array-valued field.
  try {
    const obj = JSON.parse(raw);
    if (Array.isArray(obj)) return obj;
    if (obj && typeof obj === "object") {
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) return v;
      }
    }
  } catch {
    // ignore
  }
  return null;
}
