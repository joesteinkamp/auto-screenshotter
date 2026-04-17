/**
 * Packages captured screenshots into a ZIP and triggers a download.
 */

import JSZip from "jszip";
import type { CapturedPage } from "../types";
import { getScreenshot } from "../lib/storage";
import { urlToSlug } from "../lib/url";

export async function buildZip(pages: CapturedPage[]): Promise<Blob> {
  const zip = new JSZip();
  const manifest: Array<Record<string, unknown>> = [];

  const sorted = [...pages].sort((a, b) => a.order - b.order);

  for (const page of sorted) {
    const prefix = String(page.order).padStart(3, "0");
    const slug = urlToSlug(page.url);
    
    if (page.blobKeys && page.blobKeys.length > 0) {
      const parts: string[] = [];
      for (let i = 0; i < page.blobKeys.length; i++) {
        const blob = await getScreenshot(page.blobKeys[i]);
        if (!blob) continue;
        // Differentiate AI-captured states from scroll tiles
        const isState = page.blobKeys[i].includes("-state");
        const suffix = isState
          ? `-state${page.blobKeys[i].match(/-state(\d+)/)?.[1] ?? i}`
          : `-part${i + 1}`;
        const filename = `${prefix}-${slug}${suffix}.png`;
        const buf = await blob.arrayBuffer();
        zip.file(filename, buf);
        parts.push(filename);
      }
      if (parts.length > 0) {
        manifest.push({
          filenames: parts,
          url: page.url,
          title: page.title,
          score: page.score,
          captured_at: new Date(page.capturedAt).toISOString(),
        });
      }
    } else {
      const blob = await getScreenshot(page.blobKey);
      if (!blob) continue;
      const filename = `${prefix}-${slug}.png`;
      const buf = await blob.arrayBuffer();
      zip.file(filename, buf);
      manifest.push({
        filename,
        url: page.url,
        title: page.title,
        score: page.score,
        captured_at: new Date(page.capturedAt).toISOString(),
      });
    }
  }

  zip.file(
    "manifest.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), pages: manifest }, null, 2),
  );

  return await zip.generateAsync({ type: "blob" });
}

export async function downloadZip(pages: CapturedPage[]): Promise<void> {
  const zipBlob = await buildZip(pages);
  const dataUrl = await blobToDataUrl(zipBlob);
  const filename = `auto-screenshotter-${timestamp()}.zip`;
  await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: true,
  });
}

/**
 * Build a zip for an MCP-triggered job and auto-save (no Save As prompt) to
 * the browser's default downloads folder under `auto-screenshotter/`.
 * Returns the final chosen filename (relative to Downloads) and size.
 */
export async function autoSaveZip(
  pages: CapturedPage[],
  jobId: string,
): Promise<{ filename: string; sizeBytes: number }> {
  const zipBlob = await buildZip(pages);
  const dataUrl = await blobToDataUrl(zipBlob);
  const filename = `auto-screenshotter/job-${jobId}-${timestamp()}.zip`;
  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
    conflictAction: "uniquify",
  });
  // Resolve the final filename (uniquify may have renamed it).
  const final = await resolveDownloadFilename(downloadId, filename);
  return { filename: final, sizeBytes: zipBlob.size };
}

async function resolveDownloadFilename(downloadId: number, fallback: string): Promise<string> {
  try {
    const items = await chrome.downloads.search({ id: downloadId });
    return items[0]?.filename ?? fallback;
  } catch {
    return fallback;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
