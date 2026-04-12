/**
 * Crawl orchestrator.
 *
 * Responsibilities:
 *   - Maintain the priority queue and visited set
 *   - Drive the dedicated crawl tab through each URL
 *   - Run pre-capture hygiene, take screenshot, extract links
 *   - Score discovered links and enqueue them
 *   - Optionally refine queue scores with LLM after the first page
 *   - Broadcast progress updates
 */

import type {
  CapturedPage,
  CrawlOptions,
  CrawlState,
  ScoredLink,
} from "../types";
import { PriorityQueue } from "../lib/queue";
import { normalizeUrl, textHash } from "../lib/url";
import { broadcastToPopup } from "../lib/messaging";
import {
  clearScreenshots,
  getSettings,
  putScreenshot,
} from "../lib/storage";
import { toScoredLink } from "../scoring/heuristics";
import { mergeScores, refineWithLlm } from "../scoring/llm-refiner";
import { extractLinksFromPage } from "../content/link-extractor";
import { preCapturePage } from "../content/pre-capture";
import { captureFullPage } from "./screenshot";

const SCORE_THRESHOLD = 0;
const SETTLE_AFTER_LOAD_MS = 500;

let state: CrawlState = {
  options: defaultOptions(),
  status: { state: "idle" },
  pages: [],
  startedAt: 0,
};
let abortRequested = false;
let activeTabId: number | null = null;
let llmRefined = false;

function defaultOptions(): CrawlOptions {
  return {
    startUrl: "",
    maxPages: 50,
    maxDepth: 4,
    sameOriginOnly: true,
    useLlm: false,
    requestDelayMs: 1000,
  };
}

export function getCrawlState(): CrawlState {
  return state;
}

export async function cancelCrawl(): Promise<void> {
  abortRequested = true;
}

function broadcast(): void {
  broadcastToPopup({ type: "state/update", state });
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
  await new Promise((r) => setTimeout(r, SETTLE_AFTER_LOAD_MS));
}

async function execInTab<T>(tabId: number, func: () => T | Promise<T>): Promise<T> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
  });
  return result.result as T;
}

export async function startCrawl(options: CrawlOptions): Promise<void> {
  // Reset state
  abortRequested = false;
  llmRefined = false;
  await clearScreenshots();
  state = {
    options,
    status: { state: "running", currentUrl: options.startUrl, capturedCount: 0, queueSize: 1 },
    pages: [],
    startedAt: Date.now(),
  };
  broadcast();

  const queue = new PriorityQueue();
  const visited = new Set<string>();
  const contentHashes = new Set<string>();

  // Seed with start URL
  queue.push({
    url: options.startUrl,
    score: 1000, // force first
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

  // Create dedicated crawl tab
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  if (tab.id == null || tab.windowId == null) {
    throw new Error("Failed to create crawl tab");
  }
  activeTabId = tab.id;
  const tabId = tab.id;
  const windowId = tab.windowId;

  try {
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
        await navigateAndWait(tabId, next.url);

        // Pre-capture hygiene
        await execInTab(tabId, preCapturePage).catch(() => null);

        // Capture
        const blob = await captureFullPage(tabId, windowId);

        // Extract links + page info
        const extraction = await execInTab(tabId, extractLinksFromPage);

        // Content dedup
        const hash = textHash(extraction.textSample);
        if (contentHashes.has(hash)) {
          // Already captured functionally-identical page; skip storing
          continue;
        }
        contentHashes.add(hash);

        order++;
        const blobKey = `${order}-${normalized}`;
        await putScreenshot(blobKey, blob);

        const page: CapturedPage = {
          url: extraction.url || next.url,
          title: extraction.title || next.url,
          score: next.score,
          capturedAt: Date.now(),
          order,
          blobKey,
          contentHash: hash,
          thumbnailDataUrl: await blobToThumbnail(blob),
        };
        state.pages.push(page);

        // Score new links and enqueue
        const scored: ScoredLink[] = [];
        for (const link of extraction.links) {
          const s = toScoredLink(link, {
            sourceUrl: next.url,
            depth: next.depth + 1,
            sameOriginOnly: options.sameOriginOnly,
            startUrl: options.startUrl,
          });
          if (s && s.score >= SCORE_THRESHOLD) scored.push(s);
        }

        // Filter out already-visited URLs before enqueueing
        const fresh = scored.filter((s) => !visited.has(normalizeUrl(s.url)));

        // LLM refinement — run once after homepage
        if (options.useLlm && !llmRefined && state.pages.length === 1 && fresh.length > 0) {
          llmRefined = true;
          try {
            const settings = await getSettings();
            if (settings.anthropicApiKey) {
              const topForLlm = [...fresh].sort((a, b) => b.score - a.score).slice(0, 20);
              const refined = await refineWithLlm({
                siteUrl: options.startUrl,
                homepageTitle: page.title,
                links: topForLlm,
                apiKey: settings.anthropicApiKey,
              });
              const merged = mergeScores(fresh, refined);
              for (const link of merged) queue.push(link);
            } else {
              for (const link of fresh) queue.push(link);
            }
          } catch (err) {
            console.warn("LLM refiner failed, falling back to heuristics", err);
            for (const link of fresh) queue.push(link);
          }
        } else {
          for (const link of fresh) queue.push(link);
        }

        broadcast();
      } catch (err) {
        console.warn(`Failed to capture ${next.url}`, err);
      }

      // Politeness delay between pages
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
    if (activeTabId != null) {
      chrome.tabs.remove(activeTabId).catch(() => {});
      activeTabId = null;
    }
    broadcast();
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
