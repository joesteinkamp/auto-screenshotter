/**
 * Cross-extension bridge to joesteinkamp/web-to-figma.
 *
 * That extension exposes a `{action: "capture"}` handler used by its popup.
 * For us to call it from the auto-screenshotter service worker, web-to-figma
 * must add an `externally_connectable.ids` entry for our extension ID and
 * mirror its `chrome.runtime.onMessage` handler onto `onMessageExternal`.
 *
 * A FigmaSession is created once per crawl and tracks the chained `fileUrl`
 * so that pages 2..N land in the file produced by page 1 (when chainCaptures
 * is on and no defaultFileUrl was configured).
 */
import type {
  CapturedPageFigmaResult,
  ExtensionSettings,
  FigmaCaptureType,
} from "../types";

const DEFAULT_TIMEOUT_MS = 120_000;

export interface FigmaSession {
  extensionId: string;
  captureType: FigmaCaptureType;
  /** Mutates as the crawl progresses when chainCaptures is on. */
  fileUrl?: string;
  chainCaptures: boolean;
}

export function createFigmaSession(
  settings: ExtensionSettings,
): FigmaSession | undefined {
  const fm = settings.figmaMode;
  if (!fm.enabled) return undefined;
  if (!fm.extensionId.trim()) return undefined;
  return {
    extensionId: fm.extensionId.trim(),
    captureType: fm.defaultCaptureType,
    fileUrl: fm.defaultFileUrl.trim() || undefined,
    chainCaptures: fm.chainCaptures,
  };
}

interface SendOpts {
  tabId: number;
  windowId: number;
  timeoutMs?: number;
}

interface CaptureMessage {
  action: "capture";
  fileUrl?: string;
  useDesignSystem?: boolean;
}

interface ProgressEvent {
  type?: string;
  step?: string;
  status?: string;
  fileUrl?: string;
  error?: string;
  message?: string;
}

/**
 * Send the currently-active tab to web-to-figma and wait for completion.
 *
 * web-to-figma uses `activeTab` and injects via `chrome.scripting.executeScript`,
 * which only works on the focused tab in the focused window — so we focus
 * first, then send. We then listen on `onMessageExternal` for `capture-progress`
 * messages until we see a terminal event.
 *
 * On chained crawls, the first successful capture's `fileUrl` is stored on
 * the session and reused for subsequent pages.
 */
export async function sendPageToFigma(
  session: FigmaSession,
  opts: SendOpts,
): Promise<CapturedPageFigmaResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    await chrome.windows.update(opts.windowId, { focused: true });
    await chrome.tabs.update(opts.tabId, { active: true });
  } catch (err) {
    return {
      ok: false,
      error: `Could not focus tab: ${errMsg(err)}`,
    };
  }

  const msg: CaptureMessage = { action: "capture" };
  if (session.fileUrl) msg.fileUrl = session.fileUrl;
  if (session.captureType === "designSystem") msg.useDesignSystem = true;

  const result = await dispatchAndWait(session.extensionId, msg, timeoutMs);

  if (result.ok && result.fileUrl) {
    if (session.chainCaptures && !session.fileUrl) {
      session.fileUrl = result.fileUrl;
    }
  }
  return result;
}

function dispatchAndWait(
  extensionId: string,
  msg: CaptureMessage,
  timeoutMs: number,
): Promise<CapturedPageFigmaResult> {
  return new Promise<CapturedPageFigmaResult>((resolve) => {
    let settled = false;
    const finish = (r: CapturedPageFigmaResult) => {
      if (settled) return;
      settled = true;
      try {
        chrome.runtime.onMessageExternal.removeListener(progressListener);
      } catch {
        /* ignore */
      }
      clearTimeout(timer);
      resolve(r);
    };

    const progressListener = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
    ) => {
      if (sender.id !== extensionId) return;
      const ev = normalizeProgress(message);
      if (!ev) return;
      const tag = ev.step ?? ev.status ?? ev.type;
      if (tag === "complete" || tag === "done" || tag === "success") {
        finish({ ok: true, fileUrl: ev.fileUrl });
      } else if (tag === "error" || tag === "failed") {
        finish({ ok: false, error: ev.error ?? ev.message ?? "Figma capture failed" });
      }
    };
    chrome.runtime.onMessageExternal.addListener(progressListener);

    const timer = setTimeout(
      () => finish({ ok: false, error: `Timed out after ${timeoutMs}ms` }),
      timeoutMs,
    );

    try {
      chrome.runtime.sendMessage(extensionId, msg, (response: unknown) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          finish({
            ok: false,
            error: `web-to-figma not reachable: ${lastErr.message ?? "unknown"}`,
          });
          return;
        }
        // Some implementations resolve synchronously with the final payload.
        const ev = normalizeProgress(response);
        if (!ev) return;
        const tag = ev.step ?? ev.status ?? ev.type;
        if (tag === "complete" || tag === "done" || tag === "success") {
          finish({ ok: true, fileUrl: ev.fileUrl });
        } else if (tag === "error" || tag === "failed") {
          finish({ ok: false, error: ev.error ?? ev.message ?? "Figma capture failed" });
        }
      });
    } catch (err) {
      finish({ ok: false, error: errMsg(err) });
    }
  });
}

function normalizeProgress(raw: unknown): ProgressEvent | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as ProgressEvent;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
