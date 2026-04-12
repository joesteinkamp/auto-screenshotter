/**
 * Full-page screenshot capture via scroll + stitch.
 *
 * chrome.tabs.captureVisibleTab only captures the viewport, so we
 * scroll through the page in windowHeight increments, capture each
 * tile, and stitch them in an OffscreenCanvas (service workers
 * can't use DOM Canvas but OffscreenCanvas is available).
 */

import { measurePage, scrollToY, hideStickyElements, unhideStickyElements } from "../content/page-measure";

const CAPTURE_QUALITY = 92;
/** Chrome's captureVisibleTab is rate-limited; pace calls. */
const MIN_CAPTURE_INTERVAL_MS = 600;
let lastCaptureAt = 0;

async function paceCapture(): Promise<void> {
  const elapsed = Date.now() - lastCaptureAt;
  if (elapsed < MIN_CAPTURE_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_CAPTURE_INTERVAL_MS - elapsed));
  }
  lastCaptureAt = Date.now();
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

async function captureViewport(windowId: number): Promise<Blob> {
  await paceCapture();
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png",
    quality: CAPTURE_QUALITY,
  });
  const resp = await fetch(dataUrl);
  return await resp.blob();
}

/**
 * Capture the full scrollable height of a tab as a single PNG blob.
 */
export async function captureFullPage(tabId: number, windowId: number): Promise<Blob> {
  const metrics = await execInTab(tabId, measurePage);
  const { scrollHeight, innerHeight, innerWidth, devicePixelRatio } = metrics;

  // Safety cap — pages can be extremely tall (infinite scroll).
  // Cap stitched height at 20,000 CSS px to avoid giant canvases.
  const MAX_STITCH_HEIGHT = 20000;
  const effectiveHeight = Math.min(scrollHeight, MAX_STITCH_HEIGHT);

  const canvasWidth = Math.round(innerWidth * devicePixelRatio);
  const canvasHeight = Math.round(effectiveHeight * devicePixelRatio);

  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");

  let stickyStyleId: string | null = null;

  try {
    // First capture: scroll to top, don't hide sticky (they're supposed to be at top)
    await execInTabWithArg(tabId, scrollToY, 0);
    await new Promise((r) => setTimeout(r, 200));
    const firstTile = await captureViewport(windowId);
    const firstBitmap = await createImageBitmap(firstTile);
    ctx.drawImage(firstBitmap, 0, 0);
    firstBitmap.close();

    // Subsequent tiles: hide sticky so fixed headers don't repeat
    let y = innerHeight;
    while (y < effectiveHeight) {
      if (!stickyStyleId) {
        stickyStyleId = await execInTab(tabId, hideStickyElements);
      }
      await execInTabWithArg(tabId, scrollToY, y);
      await new Promise((r) => setTimeout(r, 200));

      const tile = await captureViewport(windowId);
      const bitmap = await createImageBitmap(tile);

      const destY = Math.round(y * devicePixelRatio);
      const tileHeightPx = bitmap.height;
      // If this is the last partial tile and overlaps, trim from top
      const remainingCssPx = effectiveHeight - y;
      const remainingDevicePx = Math.round(remainingCssPx * devicePixelRatio);
      const srcY = tileHeightPx - remainingDevicePx;

      if (srcY > 0 && remainingDevicePx < tileHeightPx) {
        // Partial final tile
        ctx.drawImage(
          bitmap,
          0, srcY, bitmap.width, remainingDevicePx,
          0, destY, bitmap.width, remainingDevicePx,
        );
      } else {
        ctx.drawImage(bitmap, 0, destY);
      }
      bitmap.close();

      y += innerHeight;
    }
  } finally {
    if (stickyStyleId) {
      await execInTabWithArg(tabId, unhideStickyElements, stickyStyleId).catch(() => {});
    }
    await execInTabWithArg(tabId, scrollToY, 0).catch(() => {});
  }

  return await canvas.convertToBlob({ type: "image/png" });
}
