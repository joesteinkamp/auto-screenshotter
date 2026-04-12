/**
 * Self-contained function designed for injection via
 * chrome.scripting.executeScript({ func: extractLinksFromPage }).
 *
 * It CANNOT reference anything outside its own body — the function
 * is serialized and executed in the target page's context.
 *
 * Returns a list of { url, anchorText, context } records and the page's
 * title + text-hash payload for dedup.
 */

import type { ExtractedLink } from "../types";

export interface PageExtraction {
  title: string;
  url: string;
  textSample: string;
  links: ExtractedLink[];
}

export function extractLinksFromPage(): PageExtraction {
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
  const seen = new Set<string>();
  const links: ExtractedLink[] = [];

  const isInside = (el: Element, tagOrSelector: string): boolean => {
    try {
      return el.closest(tagOrSelector) !== null;
    } catch {
      return false;
    }
  };

  const hasCtaClass = (el: Element): boolean => {
    const klass = (el.getAttribute("class") || "").toLowerCase();
    if (/\b(btn-primary|cta|primary|action)\b/.test(klass)) return true;
    if (el.getAttribute("role") === "button") return true;
    // Anchor styled as a button via tag ancestor
    if (el.closest("button") !== null) return true;
    return false;
  };

  const isHiddenEl = (el: Element): boolean => {
    if (el.getAttribute("aria-hidden") === "true") return true;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return true;
    if (parseFloat(style.opacity || "1") === 0) return true;
    const rect = (el as HTMLElement).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return true;
    return false;
  };

  for (const a of anchors) {
    const href = a.getAttribute("href");
    if (!href) continue;

    let absUrl: string;
    try {
      absUrl = new URL(href, document.baseURI).toString();
    } catch {
      continue;
    }

    // Per-page dedup
    if (seen.has(absUrl)) continue;
    seen.add(absUrl);

    const anchorText = (a.textContent || "").replace(/\s+/g, " ").trim();
    const style = window.getComputedStyle(a);
    const fontSizePx = parseFloat(style.fontSize) || 0;

    // Find nearest meaningful ancestor for nav detection
    const ariaLabeledAncestor = a.closest("[aria-label]");
    const ariaLabel = ariaLabeledAncestor?.getAttribute("aria-label") ?? null;

    links.push({
      url: absUrl,
      anchorText,
      context: {
        inHeader: isInside(a, "header"),
        inNav: isInside(a, "nav") || (ariaLabel ? /nav/i.test(ariaLabel) : false),
        inFooter: isInside(a, "footer"),
        isPrimaryCta: hasCtaClass(a),
        isHidden: isHiddenEl(a),
        fontSizePx,
        ariaLabel,
      },
    });
  }

  // Text sample for dedup hashing — take main content text, cap at 2000 chars
  const mainEl = document.querySelector("main") || document.body;
  const textSample = (mainEl?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 2000);

  return {
    title: document.title,
    url: document.location.href,
    textSample,
    links,
  };
}
