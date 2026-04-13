# Auto Screenshotter

A Chrome extension that crawls a website, screenshots the pages that matter, and exports them as a ZIP.

The core idea: screenshotting _every_ page is noisy. This extension ranks each discovered link with a hybrid scorer (URL patterns, anchor text, DOM context, depth) and optionally an AI pass (Anthropic Claude, OpenAI, or Google Gemini), so it prioritizes the main product flow — homepage, signup, login, dashboard, pricing, settings — and skips the boilerplate (privacy, terms, cookies, sitemap).

## Install (dev)

```bash
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` directory

## Usage

1. Click the extension icon
2. Enter a start URL (or use the active tab's URL, which is pre-filled)
3. Optional: adjust max pages, max depth, same-origin toggle, request delay
4. Optional: pick a provider in **Settings** (Anthropic, OpenAI, or Gemini), paste its API key, then enable **Use &lt;provider&gt; to rank pages** on the main form
5. Click **Start Crawl**
6. When the crawl completes or is cancelled, click **Download ZIP**

The ZIP contains numbered PNGs (in crawl order) plus a `manifest.json` with each page's URL, title, score, and capture timestamp.

## How it decides what to crawl

**Heuristic scoring** — each link gets a score from ~-100 to ~+100 combining:

- **URL pattern**: `/pricing`, `/signup`, `/dashboard` score high; `/privacy`, `/terms`, `/cookies`, `/sitemap` score deeply negative
- **Anchor text**: "Sign up", "Get started", "Log in", "Pricing" positive; "Privacy Policy", "Unsubscribe", "Careers" negative
- **DOM context**: links in `<nav>`/`<header>` or styled as primary CTAs score higher; footer and hidden links score lower
- **Depth penalty**: deeper pages lose points
- **Query string penalties**: `?page=2`, filter/sort params docked heavily

A priority queue drives the crawl — highest-scored links visited first. Score threshold for enqueueing is 0 by default.

**Optional AI refiner** — when enabled, after the homepage is captured, the top ~20 discovered links are sent to the selected provider for a re-rank. Scores are merged 40% heuristic / 60% LLM. Failures fall back silently to pure heuristics.

Supported providers and default models:

| Provider  | Default model              | Notes                                      |
| --------- | -------------------------- | ------------------------------------------ |
| Anthropic | `claude-haiku-4-5-20251001`| Uses system-prompt caching for cheap reruns |
| OpenAI    | `gpt-4o-mini`              | Uses `response_format: json_object`         |
| Gemini    | `gemini-2.0-flash`         | Uses `responseMimeType: application/json`   |

Each provider's API key (and an optional model override) is stored locally in `chrome.storage.local`. Keys are sent directly from the extension to the provider's API — nothing proxies through a server.

## Architecture

- `src/background/service-worker.ts` — MV3 service worker, message router
- `src/background/crawler.ts` — orchestrates the crawl loop
- `src/background/screenshot.ts` — full-page capture via scroll-and-stitch in `OffscreenCanvas`
- `src/background/exporter.ts` — ZIP packaging and download
- `src/content/link-extractor.ts` — extracts links + DOM context from each page
- `src/content/pre-capture.ts` — dismisses cookie banners and modals before capture
- `src/content/page-measure.ts` — scroll geometry + sticky-element hiding
- `src/scoring/heuristics.ts` + `patterns.ts` — rule-based scorer
- `src/scoring/llm-refiner.ts` — optional AI pass (Anthropic / OpenAI / Gemini)
- `src/popup/` — React popup UI
- `src/lib/` — queue, storage (IndexedDB via `idb`), URL utils, typed messaging

## Development

```bash
npm run dev         # Vite dev server with HMR
npm run typecheck   # tsc --noEmit
npm test            # Vitest unit tests (scoring, queue, url utils)
npm run build       # Production build into dist/
```

## Notes

- Screenshots are full-page via scroll-and-stitch; sticky headers are temporarily neutralized on non-first tiles to prevent duplication in the stitched image.
- A safety cap limits stitched height to 20,000 CSS px.
- `chrome.tabs.captureVisibleTab` is rate-limited by Chrome; capture calls are paced internally.
- Screenshots are stored in IndexedDB during the crawl and cleared at the start of each new crawl.
