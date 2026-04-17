/**
 * Vision-based page analyzer. Sends a viewport screenshot to the
 * selected AI provider and asks it to identify interactive UI elements
 * (dropdowns, accordions, hamburger menus, tabs, toggles, etc.) that
 * would reveal new visual states when clicked.
 *
 * All three providers support image/vision input on their default models.
 */

import type { AiProvider, InteractiveElement } from "../types";

/** Vision-capable models — same as the defaults in llm-refiner. */
export const VISION_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
};

const VISION_PROMPT = `You are analyzing a screenshot of a web page. Your job is to identify interactive UI elements that would reveal NEW visual states when clicked — things a user would interact with to see hidden content.

Look for:
- Dropdown menus (navigation dropdowns, select-style dropdowns)
- Hamburger / mobile menu icons
- Accordion panels (expand/collapse sections)
- Tab controls
- Toggle switches or show/hide buttons
- "More" buttons that expand content
- Tooltips triggers
- Modal/dialog trigger buttons

Do NOT include:
- Regular navigation links (these navigate to other pages, not reveal states)
- Form submit buttons
- External links
- Scroll indicators
- Elements that are already in their expanded/open state

For each element found, return a JSON array. Each entry:
  { "selector": "<CSS selector to find the element>", "description": "<what it is, <=10 words>", "x": <center X in CSS pixels>, "y": <center Y in CSS pixels> }

The x/y coordinates should be relative to the top-left of the screenshot image. Estimate the center point of the clickable area.

If you find no interactive elements worth clicking, return an empty array: []

Return ONLY the JSON array, no other text.`;

/** Cap how many elements we process per page to limit cost/time. */
export const MAX_INTERACTIONS_PER_PAGE = 5;

export interface VisionInput {
  /** Base64-encoded PNG screenshot of the viewport. */
  screenshotBase64: string;
  provider: AiProvider;
  apiKey: string;
  /** Optional model override; falls back to VISION_MODELS[provider]. */
  model?: string;
}

export async function analyzePageForInteractiveElements(
  input: VisionInput,
): Promise<InteractiveElement[]> {
  const model = input.model || VISION_MODELS[input.provider];

  let text: string;
  switch (input.provider) {
    case "anthropic":
      text = await callAnthropicVision(input.apiKey, model, input.screenshotBase64);
      break;
    case "openai":
      text = await callOpenAiVision(input.apiKey, model, input.screenshotBase64);
      break;
    case "gemini":
      text = await callGeminiVision(input.apiKey, model, input.screenshotBase64);
      break;
    default: {
      const _exhaustive: never = input.provider;
      throw new Error(`Unknown AI provider: ${String(_exhaustive)}`);
    }
  }

  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      (e): e is InteractiveElement =>
        e != null &&
        typeof e === "object" &&
        typeof (e as InteractiveElement).selector === "string" &&
        typeof (e as InteractiveElement).x === "number" &&
        typeof (e as InteractiveElement).y === "number",
    )
    .slice(0, MAX_INTERACTIONS_PER_PAGE);
}

// ---- Provider-specific vision calls ----

async function callAnthropicVision(
  apiKey: string,
  model: string,
  base64Png: string,
): Promise<string> {
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
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: base64Png,
              },
            },
            { type: "text", text: VISION_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Anthropic Vision HTTP ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return data.content.find((b) => b.type === "text")?.text ?? "";
}

async function callOpenAiVision(
  apiKey: string,
  model: string,
  base64Png: string,
): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Png}`,
                detail: "low",
              },
            },
            { type: "text", text: VISION_PROMPT },
          ],
        },
      ],
      temperature: 0,
    }),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI Vision HTTP ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    choices: Array<{ message: { content: string | null } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

async function callGeminiVision(
  apiKey: string,
  model: string,
  base64Png: string,
): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "image/png",
                data: base64Png,
              },
            },
            { text: VISION_PROMPT },
          ],
        },
      ],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Gemini Vision HTTP ${resp.status}: ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

// ---- JSON extraction ----

function extractJsonArray(text: string): unknown {
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
