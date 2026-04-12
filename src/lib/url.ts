/**
 * URL normalization and classification helpers.
 */

const SKIP_EXTENSIONS = [
  ".pdf", ".zip", ".tar", ".gz", ".rar",
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico",
  ".mp4", ".mp3", ".webm", ".mov", ".avi",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".css", ".js", ".json", ".xml",
];

/**
 * Normalize a URL for dedup purposes: lowercase host, strip fragment,
 * sort query params, drop trailing slash (except root).
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    // Sort query params
    const entries = Array.from(u.searchParams.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    u.search = "";
    for (const [k, v] of entries) u.searchParams.append(k, v);
    let out = u.toString();
    if (out.endsWith("/") && u.pathname !== "/") out = out.slice(0, -1);
    return out;
  } catch {
    return raw;
  }
}

export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

export function hasSkippedExtension(raw: string): boolean {
  try {
    const path = new URL(raw).pathname.toLowerCase();
    return SKIP_EXTENSIONS.some((ext) => path.endsWith(ext));
  } catch {
    return false;
  }
}

/**
 * Build a filesystem-safe slug from a URL for ZIP filenames.
 */
export function urlToSlug(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/^\/+|\/+$/g, "") || "home";
    return (
      path
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "page"
    );
  } catch {
    return "page";
  }
}

/**
 * Cheap hash (djb2) for content-based dedup. Not cryptographic.
 */
export function textHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
