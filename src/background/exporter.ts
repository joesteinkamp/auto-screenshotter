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
    const blob = await getScreenshot(page.blobKey);
    if (!blob) continue;
    const prefix = String(page.order).padStart(3, "0");
    const filename = `${prefix}-${urlToSlug(page.url)}.png`;
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
