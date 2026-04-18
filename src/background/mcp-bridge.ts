/**
 * Translates `tool_call` envelopes from the relay into extension actions.
 *
 * Tools:
 *   screenshot_urls(urls, useLlm?, scrollBehavior?)
 *   crawl_site(startUrl, maxPages?, maxDepth?, useLlm?, sameOriginOnly?)
 *   get_job_status(jobId?, waitForChange?, sinceTs?)
 *
 * Capture tools return immediately with `{jobId, status: "running"}`. The AI
 * client polls `get_job_status` (with `waitForChange: true` for long-poll)
 * to see progress and get the final zip filename.
 *
 * Capture tools open a dedicated inactive tab via chrome.tabs.create so the
 * user's current browsing isn't hijacked. The tab is closed when the job
 * finishes.
 */

import type {
  CrawlOptions,
  Job,
  JobContext,
  JobKind,
  RelayInbound,
  RelayToolCallEnvelope,
  ScrollBehavior,
} from "../types";
import {
  getCrawlState,
  isCrawlRunning,
  startCrawl,
  startScreenshotBatch,
} from "./crawler";
import { autoSaveZip } from "./exporter";
import {
  createJob,
  getJob,
  getLatestJob,
  updateJob,
  waitForStatusChange,
} from "./job-manager";
import { sendToRelay } from "./relay-client";

const LONG_POLL_TIMEOUT_MS = 60_000;

export async function handleRelayMessage(msg: RelayInbound): Promise<void> {
  if (msg.type !== "tool_call") return;
  try {
    await handleToolCall(msg);
  } catch (err) {
    sendToRelay({
      type: "tool_result",
      rpcId: msg.rpcId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleToolCall(call: RelayToolCallEnvelope): Promise<void> {
  switch (call.tool) {
    case "screenshot_urls":
      await toolScreenshotUrls(call);
      return;
    case "crawl_site":
      await toolCrawlSite(call);
      return;
    case "get_job_status":
      await toolGetJobStatus(call);
      return;
    default:
      sendToRelay({
        type: "tool_result",
        rpcId: call.rpcId,
        ok: false,
        error: `unknown tool: ${call.tool}`,
      });
  }
}

async function toolScreenshotUrls(call: RelayToolCallEnvelope): Promise<void> {
  const { urls, useLlm, scrollBehavior } = call.args as {
    urls?: unknown;
    useLlm?: unknown;
    scrollBehavior?: unknown;
  };
  if (!Array.isArray(urls) || urls.length === 0 || !urls.every((u) => typeof u === "string")) {
    sendToRelay({
      type: "tool_result",
      rpcId: call.rpcId,
      ok: false,
      error: "urls must be a non-empty array of strings",
    });
    return;
  }
  if (isCrawlRunning()) {
    sendToRelay({
      type: "tool_result",
      rpcId: call.rpcId,
      ok: false,
      error: "extension busy: another job is in progress",
    });
    return;
  }

  const opts: Partial<CrawlOptions> = {
    useLlm: typeof useLlm === "boolean" ? useLlm : false,
    scrollBehavior: isScrollBehavior(scrollBehavior) ? scrollBehavior : "combine",
  };

  await runCaptureJob("screenshot_urls", call, urls.length, async (ctx) => {
    await startScreenshotBatch(urls as string[], opts, ctx);
  });
}

async function toolCrawlSite(call: RelayToolCallEnvelope): Promise<void> {
  const {
    startUrl,
    maxPages,
    maxDepth,
    useLlm,
    sameOriginOnly,
    scrollBehavior,
  } = call.args as {
    startUrl?: unknown;
    maxPages?: unknown;
    maxDepth?: unknown;
    useLlm?: unknown;
    sameOriginOnly?: unknown;
    scrollBehavior?: unknown;
  };
  if (typeof startUrl !== "string" || startUrl.length === 0) {
    sendToRelay({
      type: "tool_result",
      rpcId: call.rpcId,
      ok: false,
      error: "startUrl must be a non-empty string",
    });
    return;
  }
  if (isCrawlRunning()) {
    sendToRelay({
      type: "tool_result",
      rpcId: call.rpcId,
      ok: false,
      error: "extension busy: another job is in progress",
    });
    return;
  }

  const options: CrawlOptions = {
    startUrl,
    maxPages: typeof maxPages === "number" ? maxPages : 25,
    maxDepth: typeof maxDepth === "number" ? maxDepth : 3,
    sameOriginOnly: typeof sameOriginOnly === "boolean" ? sameOriginOnly : true,
    useLlm: typeof useLlm === "boolean" ? useLlm : false,
    requestDelayMs: 1000,
    scrollBehavior: isScrollBehavior(scrollBehavior) ? scrollBehavior : "combine",
  };

  await runCaptureJob("crawl_site", call, options.maxPages, async (ctx) => {
    await startCrawl(options, ctx);
  });
}

async function toolGetJobStatus(call: RelayToolCallEnvelope): Promise<void> {
  const {
    jobId,
    waitForChange,
    sinceTs,
  } = call.args as { jobId?: unknown; waitForChange?: unknown; sinceTs?: unknown };

  let job: Job | undefined;
  if (typeof jobId === "string") {
    job = getJob(jobId);
  } else {
    job = getLatestJob();
  }
  if (!job) {
    sendToRelay({
      type: "tool_result",
      rpcId: call.rpcId,
      ok: false,
      error: "no job found",
    });
    return;
  }

  const since = typeof sinceTs === "number" ? sinceTs : 0;
  if (waitForChange === true && job.status.state === "running") {
    job = (await waitForStatusChange(job.id, since, LONG_POLL_TIMEOUT_MS)) ?? job;
  }

  sendToRelay({
    type: "tool_result",
    rpcId: call.rpcId,
    ok: true,
    content: [{ type: "text", text: renderJobSummary(job) }],
  });
}

function renderJobSummary(job: Job): string {
  const lines: string[] = [];
  lines.push(`Job ${job.id} (${job.kind}): ${job.status.state}`);
  lines.push(`Captured: ${job.pageCount} pages${job.totalCount ? ` of ${job.totalCount}` : ""}`);
  if (job.status.state === "running" && job.currentUrl) {
    lines.push(`Current: ${job.currentUrl}`);
  }
  if (job.zipFilename) {
    lines.push(`Zip saved to Downloads: ${job.zipFilename}`);
  }
  if (job.errorMessage) {
    lines.push(`Error: ${job.errorMessage}`);
  }
  lines.push(`updatedAt: ${job.updatedAt}`);
  return lines.join("\n");
}

/**
 * Common scaffold for capture tools: mint the job, open a dedicated tab,
 * acknowledge the call immediately with `{jobId}`, then run the provided
 * crawl function in the background. When the crawl settles, build the zip
 * and record its filename on the job (which wakes any long-pollers).
 */
async function runCaptureJob(
  kind: JobKind,
  call: RelayToolCallEnvelope,
  expectedCount: number,
  run: (ctx: JobContext) => Promise<void>,
): Promise<void> {
  const job = createJob(kind);
  updateJob(job.id, { totalCount: expectedCount });

  let tabId: number;
  try {
    const win = await chrome.windows.create({
      url: "about:blank",
      focused: false,
    });
    const t = win?.tabs?.[0];
    if (t?.id == null) throw new Error("chrome.windows.create returned no tab");
    tabId = t.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateJob(job.id, {
      status: { state: "error", message, capturedCount: 0 },
      errorMessage: message,
      finishedAt: Date.now(),
    });
    sendToRelay({
      type: "tool_result",
      rpcId: call.rpcId,
      ok: false,
      error: `failed to open capture tab: ${message}`,
    });
    return;
  }

  // Ack immediately so the AI client doesn't block on a long capture.
  sendToRelay({
    type: "tool_result",
    rpcId: call.rpcId,
    ok: true,
    content: [
      {
        type: "text",
        text:
          `Job ${job.id} started (${kind}, ${expectedCount} ${kind === "screenshot_urls" ? "URLs" : "page budget"}).\n` +
          `Poll get_job_status({ jobId: "${job.id}", waitForChange: true }) for updates. ` +
          `Watch progress live in the extension side panel.`,
      },
    ],
  });

  const ctx: JobContext = { jobId: job.id, tabId, ownsTab: true };
  try {
    await run(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateJob(job.id, {
      status: { state: "error", message, capturedCount: 0 },
      errorMessage: message,
    });
  }

  const finalJob = getJob(job.id);
  if (finalJob && finalJob.status.state === "complete" && finalJob.pageCount > 0) {
    try {
      // crawler's module-level state.pages is still populated post-run.
      const { pages } = getCrawlState();
      const { filename } = await autoSaveZip(pages, job.id);
      updateJob(job.id, { zipFilename: filename });
    } catch (err) {
      console.warn("[auto-screenshotter] autoSaveZip failed", err);
    }
  }
}

function isScrollBehavior(v: unknown): v is ScrollBehavior {
  return v === "combine" || v === "separate" || v === "none";
}
