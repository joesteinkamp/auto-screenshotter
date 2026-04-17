# Auto Screenshotter

A Chrome extension that crawls a website, screenshots the pages that matter, and exports them as a ZIP.

The core idea: screenshotting _every_ page is noisy. This extension ranks each discovered link with a hybrid scorer (URL patterns, anchor text, DOM context, depth) so it prioritizes the main product flow — homepage, signup, login, dashboard, pricing, settings — and skips the boilerplate (privacy, terms, cookies, sitemap). Optionally, AI vision (Anthropic Claude, OpenAI, or Google Gemini) can be used to detect and capture dynamic page states like dropdown menus, accordions, and hamburger menus.

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
4. Optional: pick a provider in **Settings** (Anthropic, OpenAI, or Gemini), paste its API key, then enable **Capture menus & dynamic page states (needs AI key)** on the main form
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

**Optional AI dynamic state capture** — when enabled, after each page screenshot the extension sends the viewport image to the selected AI provider's vision API. The model identifies interactive elements (dropdown menus, hamburger icons, accordions, tabs, toggles) and returns their locations. The crawler then clicks each one, waits for animations, captures the resulting UI state, and includes those state screenshots in the ZIP alongside the main page screenshots.

Supported providers and default models:

| Provider  | Default model              | Notes                                      |
| --------- | -------------------------- | ------------------------------------------ |
| Anthropic | `claude-haiku-4-5-20251001`| Vision API with base64 image input          |
| OpenAI    | `gpt-4o-mini`              | Vision via `image_url` content part         |
| Gemini    | `gemini-2.5-flash`         | Vision via `inlineData` part                |

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
- `src/scoring/vision-analyzer.ts` — AI vision analysis for interactive element detection
- `src/scoring/llm-refiner.ts` — legacy AI pass (no longer called, kept for reference)
- `src/content/interact-and-capture.ts` — content scripts for clicking elements by selector/coordinates
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
