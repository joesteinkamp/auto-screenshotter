/**
 * Heuristic DOM-based detector for interactive UI elements.
 *
 * Self-contained content-script function — injected via
 * chrome.scripting.executeScript and executed in the page context, so it
 * cannot reference anything outside its own body.
 *
 * Returns up to MAX_HEURISTIC_INTERACTIONS candidates ranked by a confidence
 * score derived from ARIA, framework, structural, and visual signals.
 */

import type { InteractiveElement } from "../types";

export const MAX_HEURISTIC_INTERACTIONS = 8;

export function detectInteractiveElements(): InteractiveElement[] {
  const MAX = 8;

  type Cand = {
    el: HTMLElement;
    score: number;
    description: string;
  };

  const isVisible = (el: Element): boolean => {
    if (el.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity || "1") === 0) return false;
    const rect = (el as HTMLElement).getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    return true;
  };

  const inExtendedViewport = (el: HTMLElement): boolean => {
    const rect = el.getBoundingClientRect();
    const limit = window.innerHeight * 2;
    return rect.top < limit && rect.bottom > -100;
  };

  const cssEscape = (s: string): string => {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(s);
    }
    return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
  };

  const buildSelector = (el: HTMLElement): string => {
    if (el.id) return `#${cssEscape(el.id)}`;
    const testId = el.getAttribute("data-testid");
    if (testId) return `[data-testid="${cssEscape(testId)}"]`;

    const parts: string[] = [];
    let node: HTMLElement | null = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`#${cssEscape(node.id)}`);
        break;
      }
      const classes = (node.getAttribute("class") || "")
        .trim()
        .split(/\s+/)
        .filter((c) => c && !/[:[\]()]/.test(c) && c.length < 40)
        .slice(0, 2);
      if (classes.length > 0) {
        part += "." + classes.map(cssEscape).join(".");
      }
      const parent: HTMLElement | null = node.parentElement;
      if (parent) {
        const tag = node.tagName;
        const same = Array.from(parent.children).filter(
          (c: Element) => c.tagName === tag,
        );
        if (same.length > 1) {
          const idx = same.indexOf(node) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }
      parts.unshift(part);
      node = parent;
      depth++;
    }
    return parts.join(" > ");
  };

  const shortText = (el: HTMLElement): string => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim().slice(0, 40);
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (txt) return txt.slice(0, 40);
    const title = el.getAttribute("title");
    if (title) return title.trim().slice(0, 40);
    return el.tagName.toLowerCase();
  };

  const candidates = new Map<HTMLElement, Cand>();

  const add = (el: HTMLElement, score: number, kind: string): void => {
    if (!isVisible(el)) return;
    if (!inExtendedViewport(el)) return;
    const existing = candidates.get(el);
    const desc = `${kind}: ${shortText(el)}`;
    if (!existing || existing.score < score) {
      candidates.set(el, { el, score, description: desc });
    }
  };

  // --- ARIA / role-based (high confidence: 80) ---
  document
    .querySelectorAll<HTMLElement>('[aria-haspopup]:not([aria-expanded="true"])')
    .forEach((el) => add(el, 90, "aria-haspopup"));
  document
    .querySelectorAll<HTMLElement>('[aria-expanded="false"]')
    .forEach((el) => add(el, 88, "aria-expanded"));
  document
    .querySelectorAll<HTMLElement>("details:not([open]) > summary")
    .forEach((el) => add(el, 85, "details/summary"));
  document
    .querySelectorAll<HTMLElement>('[role="tab"]:not([aria-selected="true"])')
    .forEach((el) => add(el, 75, "tab"));
  document
    .querySelectorAll<HTMLElement>("[aria-controls]")
    .forEach((el) => {
      const ctrlId = el.getAttribute("aria-controls");
      if (!ctrlId) return;
      const target = document.getElementById(ctrlId);
      if (!target) return;
      const ts = window.getComputedStyle(target);
      const hidden =
        ts.display === "none" ||
        ts.visibility === "hidden" ||
        target.getAttribute("aria-hidden") === "true";
      if (hidden) add(el, 80, "aria-controls(hidden)");
    });

  // --- Framework patterns (medium-high: 70) ---
  document
    .querySelectorAll<HTMLElement>("[data-toggle], [data-bs-toggle]")
    .forEach((el) => add(el, 75, "data-toggle"));

  const classRe =
    /(^|[\s_-])(dropdown|accordion|hamburger|menu-toggle|nav-toggle|disclosure|collapse)(-toggle)?($|[\s_-])/i;
  document.querySelectorAll<HTMLElement>("[class]").forEach((el) => {
    const klass = el.getAttribute("class") || "";
    if (classRe.test(klass)) add(el, 65, "class-pattern");
  });

  // --- Structural: nav/header items with hidden submenus (medium: 60) ---
  document
    .querySelectorAll<HTMLElement>('nav li, header li, [role="menubar"] > *')
    .forEach((el) => {
      const sub = el.querySelector<HTMLElement>('ul, [role="menu"]');
      if (!sub) return;
      const ss = window.getComputedStyle(sub);
      const hidden =
        ss.display === "none" ||
        ss.visibility === "hidden" ||
        parseFloat(ss.opacity || "1") === 0 ||
        sub.getAttribute("aria-hidden") === "true";
      if (!hidden) return;
      // Score the trigger (link or button), not the li wrapper.
      const trigger =
        el.querySelector<HTMLElement>("a, button, [role='button']") || el;
      add(trigger, 70, "nav-submenu");
    });

  // --- Visual hint: chevron/caret descendants give +5 ---
  const chevronRe = /chevron|caret|arrow-down|expand/i;
  for (const cand of candidates.values()) {
    const hasChevron = cand.el.querySelector(
      'svg[class*="chevron"], svg[class*="caret"], i[class*="chevron"], i[class*="caret"], [class*="arrow-down"], [class*="expand"]',
    );
    if (hasChevron) cand.score += 5;
    const ownClass = cand.el.getAttribute("class") || "";
    if (chevronRe.test(ownClass)) cand.score += 3;
  }

  // Sort, dedupe by ancestor (skip if an ancestor candidate scored higher),
  // and convert to InteractiveElement.
  const sorted = Array.from(candidates.values()).sort((a, b) => b.score - a.score);

  const keptEls: HTMLElement[] = [];
  const out: InteractiveElement[] = [];
  for (const c of sorted) {
    if (out.length >= MAX) break;
    const containsKept = keptEls.some(
      (k) => c.el !== k && (c.el.contains(k) || k.contains(c.el)),
    );
    if (containsKept) continue;
    const rect = c.el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    out.push({
      selector: buildSelector(c.el),
      description: c.description,
      x,
      y,
      source: "heuristic",
      confidence: c.score,
    });
    keptEls.push(c.el);
  }

  return out;
}
