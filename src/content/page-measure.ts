/**
 * Self-contained functions for measuring page scroll geometry and
 * orchestrating scroll during full-page screenshot capture.
 * All designed for chrome.scripting.executeScript injection.
 */

export interface PageMetrics {
  scrollHeight: number;
  innerHeight: number;
  innerWidth: number;
  devicePixelRatio: number;
}

export function measurePage(): PageMetrics {
  const doc = document.documentElement;
  const body = document.body;
  const scrollHeight = Math.max(
    doc.scrollHeight,
    body?.scrollHeight ?? 0,
    doc.clientHeight,
  );
  return {
    scrollHeight,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

export function scrollToY(y: number): void {
  window.scrollTo({ top: y, left: 0, behavior: "auto" });
}

/**
 * Inject a style that hides position: fixed/sticky elements during
 * tile-by-tile capture (so headers don't appear repeatedly).
 * Returns an ID used to remove the style later.
 */
export function hideStickyElements(): string {
  const id = "auto-screenshotter-hide-sticky";
  if (document.getElementById(id)) return id;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    *[style*="position: fixed"],
    *[style*="position:fixed"],
    *[style*="position: sticky"],
    *[style*="position:sticky"] { position: absolute !important; }
    header[class], nav[class], [class*="sticky"], [class*="fixed-top"],
    [class*="navbar-fixed"] { position: absolute !important; }
  `;
  document.head.appendChild(style);
  return id;
}

export function unhideStickyElements(id: string): void {
  document.getElementById(id)?.remove();
}
