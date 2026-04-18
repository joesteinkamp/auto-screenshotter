/**
 * MV3 service worker entry point.
 *
 * Two inbound paths:
 *   - Side panel messages (chrome.runtime.onMessage) — mcp/* and crawl/* methods.
 *   - MCP tool calls from the relay (chrome WebSocket) — routed through mcp-bridge.
 */

import type {
  BackgroundMessage,
  BackgroundResponse,
  CrawlOptions,
  JobContext,
  ScrollBehavior,
} from "../types";
import {
  cancelCrawl,
  getCrawlState,
  isCrawlRunning,
  startCrawl,
  startSinglePageCapture,
} from "./crawler";
import { downloadZip } from "./exporter";
import { createJob, ensureRehydrated, listJobs } from "./job-manager";
import { handleRelayMessage } from "./mcp-bridge";
import {
  getConnectionInfo,
  initRelay,
  onRelayCommand,
  setRelayEnabled,
  setRelayUrlOverride,
} from "./relay-client";

// ---- Side panel behavior: toolbar click opens the panel ----

chrome.runtime.onInstalled.addListener(async () => {
  console.log("[auto-screenshotter] installed");
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    console.warn("setPanelBehavior failed", err);
  }
  await ensureRehydrated();
  await initRelay();
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    /* */
  }
  await ensureRehydrated();
  await initRelay();
});

// Also attempt on module load (SW cold start without onStartup firing).
ensureRehydrated().catch(() => undefined);
initRelay().catch(() => undefined);

onRelayCommand((cmd) => {
  handleRelayMessage(cmd).catch((err) => {
    console.warn("[auto-screenshotter] relay command failed", err);
  });
});

// ---- Panel message router ----

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (resp: BackgroundResponse) => void) => {
    const msg = message as BackgroundMessage;
    if (!msg || typeof msg !== "object" || !("type" in msg)) {
      sendResponse({ ok: false, error: "invalid message" });
      return false;
    }

    handleMessage(msg).then(sendResponse).catch((err) => {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return true;
  },
);

async function handleMessage(msg: BackgroundMessage): Promise<BackgroundResponse> {
  switch (msg.type) {
    case "crawl/start":
      return startPanelCrawl(msg.options);

    case "crawl/captureCurrent":
      return startPanelSingleCapture(msg.scrollBehavior);

    case "crawl/cancel":
      await cancelCrawl();
      return { ok: true, state: getCrawlState() };

    case "crawl/getState":
      return { ok: true, state: getCrawlState() };

    case "crawl/download": {
      const state = getCrawlState();
      if (state.pages.length === 0) {
        return { ok: false, error: "No pages captured yet" };
      }
      await downloadZip(state.pages);
      return { ok: true, state };
    }

    case "mcp/getStatus": {
      const info = await getConnectionInfo();
      return { ok: true, mcp: info };
    }

    case "mcp/setEnabled":
      await setRelayEnabled(msg.enabled);
      return { ok: true, mcp: await getConnectionInfo() };

    case "mcp/setRelayOverride":
      await setRelayUrlOverride(msg.url);
      return { ok: true, mcp: await getConnectionInfo() };

    case "jobs/list":
      return { ok: true, jobs: listJobs() };
  }
}

async function startPanelSingleCapture(
  scrollBehavior: ScrollBehavior,
): Promise<BackgroundResponse> {
  if (isCrawlRunning()) {
    return { ok: false, error: "A capture is already running" };
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id == null) {
    return { ok: false, error: "No active tab found" };
  }
  if (!tab.url || !/^https?:\/\//.test(tab.url)) {
    return { ok: false, error: "Active tab is not an http(s) page" };
  }
  const job = createJob("panel");
  const ctx: JobContext = { jobId: job.id, tabId: tab.id, ownsTab: false };
  startSinglePageCapture(scrollBehavior, ctx).catch((err) => {
    console.error("Single capture failed", err);
  });
  return { ok: true, state: getCrawlState() };
}

async function startPanelCrawl(options: CrawlOptions): Promise<BackgroundResponse> {
  if (isCrawlRunning()) {
    return { ok: false, error: "A crawl is already running" };
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id == null) {
    return { ok: false, error: "No active tab found" };
  }
  const job = createJob("panel");
  const ctx: JobContext = { jobId: job.id, tabId: tab.id, ownsTab: false };
  // Fire and forget — progress comes via broadcasts; crawler sets state synchronously.
  startCrawl(options, ctx).catch((err) => {
    console.error("Crawl failed", err);
  });
  return { ok: true, state: getCrawlState() };
}
