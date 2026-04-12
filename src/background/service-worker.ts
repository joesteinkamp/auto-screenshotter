/**
 * MV3 service worker entry point. Routes messages from the popup.
 */

import type { BackgroundMessage, BackgroundResponse } from "../types";
import { cancelCrawl, getCrawlState, startCrawl } from "./crawler";
import { downloadZip } from "./exporter";

chrome.runtime.onInstalled.addListener(() => {
  console.log("[auto-screenshotter] installed");
});

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
    return true; // async response
  },
);

async function handleMessage(msg: BackgroundMessage): Promise<BackgroundResponse> {
  switch (msg.type) {
    case "crawl/start":
      // Fire and forget — progress comes via broadcasts
      startCrawl(msg.options).catch((err) => {
        console.error("Crawl failed", err);
      });
      return { ok: true, state: getCrawlState() };

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
  }
}
