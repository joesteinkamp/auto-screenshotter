/**
 * Crawl orchestrator.
 *
 * Two modes:
 *   - startCrawl(options, ctx)          — seeded with options.startUrl, discovers links, scores, enqueues.
 *   - startScreenshotBatch(urls, ctx)   — exact URL list, no discovery, no scoring.
 *
 * Both share capturePageAt() which does navigate → pre-capture → full-page
 * screenshot → store blobs → optional vision-state capture → return a
 * CapturedPage.
 *
 * ctx.jobId is threaded through IndexedDB keys (`${jobId}:${order}-${url}`)
 * so concurrent jobs never collide and the LRU purge can drop whole jobs.
 * ctx.ownsTab=true means this crawler instance is responsible for closing
 * the tab on finish (MCP-triggered jobs run in a dedicated inactive tab).
 */

import type {
  CapturedPage,
  CrawlOptions,
  CrawlState,
  ExtractedLink,
  JobContext,
  ScoredLink,
  ScrollBehavior,
} from "../types";
import { PriorityQueue } from "../lib/queue";
import { normalizeUrl, textHash } from "../lib/url";
import { broadcastToPanel } from "../lib/messaging";
import { getSettings, putScreenshot } from "../lib/storage";
import { toScoredLink } from "../scoring/heuristics";
import { analyzePageForInteractiveElements } from "../scoring/vision-analyzer";
import { extractLinksFromPage } from "../content/link-extractor";
import { preCapturePage } from "../content/pre-capture";
import { clickBySelector, clickAtPoint } from "../content/interact-and-capture";
import { captureFullPage } from "./screenshot";
import { updateJob, finishJob } from "./job-manager";

const SCORE_THRESHOLD = 0;
/** Max time to wait for readyState/images after `status: complete`. */
const QUIET_WAIT_MAX_MS = 6000;
/** Small settle delay after the page reports quiet, for late animations. */
const POST_QUIET_SETTLE_MS = 500;
const INTERACTION_SETTLE_MS = 800;

let state: CrawlState = {
  options: defaultOptions(),
  status: { state: "idle" },
  pages: [],
  startedAt: 0,
  jobId: null,
};
let abortRequested = false;
let running = false;

function defaultOptions(): CrawlOptions {
  return {
    startUrl: "",
    maxPages: 50,
    maxDepth: 4,
    sameOriginOnly: true,
    useLlm: false,
    requestDelayMs: 1000,
    scrollBehavior: "combine",
  };
}

export function getCrawlState(): CrawlState {
  return state;
}

export function isCrawlRunning(): boolean {
  return running;
}

export async function cancelCrawl(): Promise<void> {
  abortRequested = true;
}

function broadcast(): void {
  broadcastToPanel({ type: "state/update", state });
  if (state.jobId) {
    const status = state.status;
    const currentUrl =
      status.state === "running" ? status.currentUrl : undefined;
    updateJob(state.jobId, {
      status,
      pageCount: state.pages.length,
      currentUrl,
    });
  }
}

async function navigateAndWait(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url });
  await new Promise<void>((resolve) => {
    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
    ) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  await execInTabWithArg(tabId, waitForPageQuiet, QUIET_WAIT_MAX_MS).catch(() => null);
  await new Promise((r) => setTimeout(r, POST_QUIET_SETTLE_MS));
}

/**
 * Resolves when the page looks "quiet": readyState === "complete",
 * all in-viewport images have loaded (or errored), and ~500ms have passed
 * with no new image additions. Bails after `maxMs` regardless.
 */
function waitForPageQuiet(maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + maxMs;

    const imagesReady = (): boolean => {
      const imgs = Array.from(document.images);
      for (const img of imgs) {
        const rect = img.getBoundingClientRect();
        const onscreen =
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          rect.right > 0 &&
          rect.left < window.innerWidth;
        if (onscreen && !img.complete) return false;
      }
      return true;
    };

    const tick = () => {
      if (Date.now() >= deadline) return resolve();
      if (document.readyState === "complete" && imagesReady()) {
        setTimeout(resolve, 300);
        return;
      }
      setTimeout(tick, 150);
    };

    tick();
  });
}

async function execInTab<T>(tabId: number, func: () => T | Promise<T>): Promise<T> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
  });
  return result.result as T;
}

async function execInTabWithArg<T, A>(
  tabId: number,
  func: (arg: A) => T | Promise<T>,
  arg: A,
): Promise<T> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args: [arg],
  });
  return result.result as T;
}

async function captureViewportBlob(windowId: number): Promise<Blob> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png",
    quality: 92,
  });
  const resp = await fetch(dataUrl);
  return resp.blob();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface CaptureResult {
  /** CapturedPage to push onto state.pages, or null if skipped (dedup / hashed). */
  page: CapturedPage | null;
  /** Links discovered on the page (empty for screenshot-batch mode where caller doesn't want them). */
  links: ExtractedLink[];
  /** The hash of the page's visible text, for dedup. */
  contentHash: string;
}

/**
 * Navigate to url, pre-capture, take a full-page screenshot, optionally run
 * vision state capture, store all blobs under `${jobId}:${order}-${url}[...]`.
 * Returns the constructed CapturedPage plus links for callers that care.
 *
 * If `collectLinks` is false we skip the link-extractor injection entirely
 * (screenshot_urls mode doesn't need it).
 */
async function capturePageAt(
  tabId: number,
  windowId: number,
  url: string,
  order: number,
  score: number,
  jobId: string,
  options: CrawlOptions,
  collectLinks: boolean,
  seenHashes: Set<string>,
): Promise<CaptureResult> {
  await navigateAndWait(tabId, url);
  await execInTab(tabId, preCapturePage).catch(() => null);

  const blobs = await captureFullPage(tabId, windowId, options.scrollBehavior);

  let extraction: {
    url: string;
    title: string;
    textSample: string;
    links: ExtractedLink[];
  };

  if (collectLinks) {
    extraction = await execInTab(tabId, extractLinksFromPage);
  } else {
    const info = await execInTab(tabId, () => ({
      url: document.URL,
      title: document.title,
      textSample: (document.body?.innerText ?? "").slice(0, 2000),
    }));
    extraction = { ...info, links: [] };
  }

  const hash = textHash(extraction.textSample);
  if (extraction.textSample.length > 50) {
    if (seenHashes.has(hash)) {
      return { page: null, links: extraction.links, contentHash: hash };
    }
    seenHashes.add(hash);
  }

  const normalized = normalizeUrl(url);
  const baseKey = `${jobId}:${order}-${normalized}`;
  const blobKeys: string[] = [];

  if (blobs.length === 1) {
    await putScreenshot(baseKey, blobs[0]);
    blobKeys.push(baseKey);
  } else {
    for (let i = 0; i < blobs.length; i++) {
      const tileKey = `${baseKey}-tile${i}`;
      await putScreenshot(tileKey, blobs[i]);
      blobKeys.push(tileKey);
    }
  }

  const page: CapturedPage = {
    url: extraction.url || url,
    title: extraction.title || url,
    score,
    capturedAt: Date.now(),
    order,
    blobKey: blobKeys[0] ?? baseKey,
    blobKeys,
    contentHash: hash,
    thumbnailDataUrl:
      blobs.length > 0 ? await blobToThumbnail(blobs[0]) : undefined,
  };

  // Vision-based dynamic state capture
  if (options.useLlm) {
    try {
      const settings = await getSettings();
      const providerCfg = settings.providers[settings.aiProvider];
      if (providerCfg?.apiKey) {
        await new Promise((r) => setTimeout(r, 300));
        const viewportBlob = await captureViewportBlob(windowId);
        const base64 = await blobToBase64(viewportBlob);

        const elements = await analyzePageForInteractiveElements({
          screenshotBase64: base64,
          provider: settings.aiProvider,
          apiKey: providerCfg.apiKey,
          model: providerCfg.model || undefined,
        });

        if (elements.length > 0) {
          for (let si = 0; si < elements.length; si++) {
            if (abortRequested) break;
            const el = elements[si];

            let clicked = false;
            try {
              clicked = await execInTabWithArg(tabId, clickBySelector, el.selector);
            } catch {
              clicked = false;
            }
            if (!clicked) {
              try {
                clicked = await execInTabWithArg(tabId, clickAtPoint, { x: el.x, y: el.y });
              } catch {
                clicked = false;
              }
            }
            if (!clicked) continue;

            await new Promise((r) => setTimeout(r, INTERACTION_SETTLE_MS));
            const stateBlob = await captureViewportBlob(windowId);
            const stateKey = `${baseKey}-state${si}`;
            await putScreenshot(stateKey, stateBlob);
            page.blobKeys!.push(stateKey);

            await navigateAndWait(tabId, url);
            await execInTab(tabId, preCapturePage).catch(() => null);
          }
        }
      }
    } catch (err) {
      console.warn("[auto-screenshotter] Vision analysis failed, continuing", err);
    }
  }

  return { page, links: extraction.links, contentHash: hash };
}

async function resolveTab(ctx: JobContext): Promise<{ tabId: number; windowId: number }> {
  const tab = await chrome.tabs.get(ctx.tabId);
  if (tab.windowId == null) throw new Error("Tab has no window");
  return { tabId: ctx.tabId, windowId: tab.windowId };
}

async function cleanupTab(ctx: JobContext, originalUrl?: string): Promise<void> {
  if (ctx.ownsTab) {
    await chrome.tabs.remove(ctx.tabId).catch(() => undefined);
  } else if (originalUrl) {
    await chrome.tabs.update(ctx.tabId, { url: originalUrl }).catch(() => undefined);
  }
}

/**
 * Crawl starting from options.startUrl, discovering links. `ctx` identifies
 * the job and the tab to drive.
 */
export async function startCrawl(options: CrawlOptions, ctx: JobContext): Promise<void> {
  if (running) throw new Error("crawler busy");
  running = true;
  abortRequested = false;

  state = {
    options,
    status: { state: "running", currentUrl: options.startUrl, capturedCount: 0, queueSize: 1 },
    pages: [],
    startedAt: Date.now(),
    jobId: ctx.jobId,
  };
  broadcast();

  const queue = new PriorityQueue();
  const visited = new Set<string>();
  const contentHashes = new Set<string>();

  queue.push({
    url: options.startUrl,
    score: 1000,
    depth: 0,
    sourceUrl: options.startUrl,
    anchorText: "start",
    context: {
      inHeader: false,
      inNav: false,
      inFooter: false,
      isPrimaryCta: false,
      isHidden: false,
      fontSizePx: 0,
      ariaLabel: null,
    },
  });

  let originalUrl: string | undefined;
  try {
    const { tabId, windowId } = await resolveTab(ctx);
    if (!ctx.ownsTab) {
      const tab = await chrome.tabs.get(tabId);
      originalUrl = tab.url ?? undefined;
    }

    let order = 0;
    while (queue.size > 0 && state.pages.length < options.maxPages) {
      if (abortRequested) break;
      const next = queue.pop();
      if (!next) break;

      const normalized = normalizeUrl(next.url);
      if (visited.has(normalized)) continue;
      visited.add(normalized);
      if (next.depth > options.maxDepth) continue;

      state.status = {
        state: "running",
        currentUrl: next.url,
        capturedCount: state.pages.length,
        queueSize: queue.size,
      };
      broadcast();

      try {
        const result = await capturePageAt(
          tabId,
          windowId,
          next.url,
          order + 1,
          next.score,
          ctx.jobId,
          options,
          true,
          contentHashes,
        );

        if (result.page) {
          order++;
          state.pages.push(result.page);

          if (state.pages.length === 1) {
            try {
              options.startUrl = new URL(result.page.url).origin;
            } catch {
              /* retain */
            }
          }

          const scored: ScoredLink[] = [];
          for (const link of result.links) {
            const s = toScoredLink(link, {
              sourceUrl: next.url,
              depth: next.depth + 1,
              sameOriginOnly: options.sameOriginOnly,
              startUrl: options.startUrl,
            });
            if (s && s.score >= SCORE_THRESHOLD) scored.push(s);
          }
          const fresh = scored.filter((s) => !visited.has(normalizeUrl(s.url)));
          for (const link of fresh) queue.push(link);

          broadcast();
        }
      } catch (err) {
        console.warn(`Failed to capture ${next.url}`, err);
      }

      if (options.requestDelayMs > 0) {
        await new Promise((r) => setTimeout(r, options.requestDelayMs));
      }
    }

    state.status = abortRequested
      ? { state: "cancelled", capturedCount: state.pages.length }
      : { state: "complete", capturedCount: state.pages.length };
  } catch (err) {
    state.status = {
      state: "error",
      message: err instanceof Error ? err.message : String(err),
      capturedCount: state.pages.length,
    };
  } finally {
    await cleanupTab(ctx, originalUrl);
    running = false;
    broadcast();
    finishJob(ctx.jobId, state.status);
  }
}

/**
 * Screenshot exactly the given URLs. No link discovery, no scoring.
 * All pages share the same job tab.
 */
export async function startScreenshotBatch(
  urls: string[],
  options: Partial<CrawlOptions>,
  ctx: JobContext,
): Promise<void> {
  if (running) throw new Error("crawler busy");
  if (urls.length === 0) throw new Error("no URLs supplied");
  running = true;
  abortRequested = false;

  const merged: CrawlOptions = {
    ...defaultOptions(),
    ...options,
    startUrl: urls[0],
  };

  state = {
    options: merged,
    status: { state: "running", currentUrl: urls[0], capturedCount: 0, queueSize: urls.length },
    pages: [],
    startedAt: Date.now(),
    jobId: ctx.jobId,
  };
  broadcast();

  const contentHashes = new Set<string>();
  let originalUrl: string | undefined;

  try {
    const { tabId, windowId } = await resolveTab(ctx);
    if (!ctx.ownsTab) {
      const tab = await chrome.tabs.get(tabId);
      originalUrl = tab.url ?? undefined;
    }

    let order = 0;
    for (let i = 0; i < urls.length; i++) {
      if (abortRequested) break;
      const url = urls[i];

      state.status = {
        state: "running",
        currentUrl: url,
        capturedCount: state.pages.length,
        queueSize: urls.length - i - 1,
      };
      broadcast();

      try {
        const result = await capturePageAt(
          tabId,
          windowId,
          url,
          order + 1,
          100,
          ctx.jobId,
          merged,
          false,
          contentHashes,
        );
        if (result.page) {
          order++;
          state.pages.push(result.page);
          broadcast();
        }
      } catch (err) {
        console.warn(`Failed to capture ${url}`, err);
      }

      if (merged.requestDelayMs > 0 && i < urls.length - 1) {
        await new Promise((r) => setTimeout(r, merged.requestDelayMs));
      }
    }

    state.status = abortRequested
      ? { state: "cancelled", capturedCount: state.pages.length }
      : { state: "complete", capturedCount: state.pages.length };
  } catch (err) {
    state.status = {
      state: "error",
      message: err instanceof Error ? err.message : String(err),
      capturedCount: state.pages.length,
    };
  } finally {
    await cleanupTab(ctx, originalUrl);
    running = false;
    broadcast();
    finishJob(ctx.jobId, state.status);
  }
}

/**
 * Capture a single screenshot of the page currently loaded in ctx.tabId.
 * No navigation, no link extraction, no vision analysis — just the same
 * full-page capture pipeline the crawler uses, so manually-grabbed shots
 * look identical to crawled ones.
 */
export async function startSinglePageCapture(
  scrollBehavior: ScrollBehavior,
  ctx: JobContext,
): Promise<void> {
  if (running) throw new Error("crawler busy");
  running = true;
  abortRequested = false;

  const tab = await chrome.tabs.get(ctx.tabId);
  const tabUrl = tab.url ?? "";

  const merged: CrawlOptions = {
    ...defaultOptions(),
    startUrl: tabUrl,
    scrollBehavior,
  };

  state = {
    options: merged,
    status: { state: "running", currentUrl: tabUrl, capturedCount: 0, queueSize: 1 },
    pages: [],
    startedAt: Date.now(),
    jobId: ctx.jobId,
  };
  broadcast();

  try {
    if (tab.windowId == null) throw new Error("Tab has no window");
    const windowId = tab.windowId;

    await execInTab(ctx.tabId, preCapturePage).catch(() => null);
    const blobs = await captureFullPage(ctx.tabId, windowId, scrollBehavior);

    const info = await execInTab(ctx.tabId, () => ({
      url: document.URL,
      title: document.title,
    }));

    const normalized = normalizeUrl(info.url || tabUrl);
    const baseKey = `${ctx.jobId}:1-${normalized}`;
    const blobKeys: string[] = [];

    if (blobs.length === 1) {
      await putScreenshot(baseKey, blobs[0]);
      blobKeys.push(baseKey);
    } else {
      for (let i = 0; i < blobs.length; i++) {
        const tileKey = `${baseKey}-tile${i}`;
        await putScreenshot(tileKey, blobs[i]);
        blobKeys.push(tileKey);
      }
    }

    const page: CapturedPage = {
      url: info.url || tabUrl,
      title: info.title || tabUrl,
      score: 1000,
      capturedAt: Date.now(),
      order: 1,
      blobKey: blobKeys[0] ?? baseKey,
      blobKeys,
      contentHash: "",
      thumbnailDataUrl:
        blobs.length > 0 ? await blobToThumbnail(blobs[0]) : undefined,
    };
    state.pages.push(page);

    state.status = { state: "complete", capturedCount: 1 };
  } catch (err) {
    state.status = {
      state: "error",
      message: err instanceof Error ? err.message : String(err),
      capturedCount: state.pages.length,
    };
  } finally {
    running = false;
    broadcast();
    finishJob(ctx.jobId, state.status);
  }
}

async function blobToThumbnail(blob: Blob): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 200 / bitmap.width);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const thumbBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(thumbBlob);
    });
  } catch {
    return undefined;
  }
}
