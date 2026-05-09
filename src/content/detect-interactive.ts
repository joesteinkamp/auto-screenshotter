/**
 * Heuristic DOM-based detector for interactive UI elements.
 *
 * Self-contained content-script function — injected via
 * chrome.scripting.executeScript and executed in the page context, so it
 * cannot reference anything outside its own body.
 *
 * Returns up to `cap * 2` (or MAX_HEURISTIC_INTERACTIONS, whichever is larger)
 * candidates ranked by a confidence score derived from ARIA, framework
 * (Radix / Headless UI / React Aria), structural, and visual signals.
 *
 * Note on React: `el.onclick` reads the IDL property; React's synthetic
 * event delegation does NOT set it. React triggers are caught indirectly
 * via the className-pattern, role, tabindex, and cursor:pointer rules.
 *
 * Medium-score candidates may be confirmed via a short dynamic probe:
 * dispatch pointerover/focus and watch a MutationObserver for DOM changes.
 */

import type { InteractiveElement } from "../types";

export const MAX_HEURISTIC_INTERACTIONS = 16;

export async function detectInteractiveElements(cap: number): Promise<InteractiveElement[]> {
  const MAX = Math.max(MAX_HEURISTIC_INTERACTIONS, (cap || 5) * 2);

  type Cand = {
    el: HTMLElement;
    score: number;
    description: string;
  };

  const NATIVE_TAGS = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
  const isNative = (el: Element): boolean => NATIVE_TAGS.has(el.tagName);

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

  // --- ARIA / role-based (high confidence) ---
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

  // --- Framework markers (Radix / Headless UI / React Aria) ---
  document
    .querySelectorAll<HTMLElement>('[data-state="closed"]')
    .forEach((el) => add(el, 92, "radix-state-closed"));

  document
    .querySelectorAll<HTMLElement>(
      '[data-headlessui-state]:not([data-headlessui-state*="open"]), [id^="headlessui-"][aria-haspopup]',
    )
    .forEach((el) => add(el, 90, "headlessui-trigger"));

  document
    .querySelectorAll<HTMLElement>(
      '[data-radix-collection-item][role="menuitem"], [data-radix-collection-item][role="tab"]:not([aria-selected="true"])',
    )
    .forEach((el) => add(el, 88, "radix-collection-item"));

  document
    .querySelectorAll<HTMLElement>(
      '[role="button"], [role="link"], [role="menuitem"], [role="switch"], [role="checkbox"], [role="combobox"], [role="listbox"]',
    )
    .forEach((el) => {
      if (isNative(el)) return;
      add(el, 78, "role-button-nonnative");
    });

  // --- Bootstrap / data-toggle ---
  document
    .querySelectorAll<HTMLElement>("[data-toggle], [data-bs-toggle]")
    .forEach((el) => add(el, 75, "data-toggle"));

  // --- Inline / property onclick ---
  document
    .querySelectorAll<HTMLElement>("div, span, li, section, article, header, nav, aside")
    .forEach((el) => {
      if ((el as unknown as { onclick: unknown }).onclick != null) {
        add(el, 75, "onclick-prop");
      }
    });
  document
    .querySelectorAll<HTMLElement>("[onclick]")
    .forEach((el) => {
      if (isNative(el)) return;
      add(el, 75, "onclick-attr");
    });

  // --- tabindex on non-interactive tag without role ---
  document
    .querySelectorAll<HTMLElement>('[tabindex="0"]')
    .forEach((el) => {
      if (isNative(el) || el.hasAttribute("role")) return;
      add(el, 70, "tabindex-nonnative");
    });

  // --- Class-name patterns: Bootstrap / shadcn / Radix / Headless UI ---
  const legacyClassRe =
    /(^|[\s_-])(dropdown|accordion|hamburger|menu-toggle|nav-toggle|disclosure|collapse)(-toggle)?($|[\s_-])/i;
  // PascalCase classnames (from CSS-in-JS / CSS modules) where a known
  // trigger keyword appears as a sub-token, e.g. "DropdownMenuTrigger".
  // Case-sensitive; lowercase/kebab forms are caught by legacyClassRe.
  const triggerClassRe =
    /(?:^|[\s_-])[A-Za-z]*(?:Trigger|Toggle|Disclosure|Popover|Dropdown|Combobox|Listbox|Switch|Tabs)[A-Za-z]*(?:$|[\s_-])/;
  document.querySelectorAll<HTMLElement>("[class]").forEach((el) => {
    const klass = el.getAttribute("class") || "";
    if (legacyClassRe.test(klass)) add(el, 65, "class-pattern");
    if (triggerClassRe.test(klass)) add(el, 68, "classname-trigger");
  });

  // --- React Aria Components ---
  document
    .querySelectorAll<HTMLElement>("[data-rac][data-pressed], [data-rac][role='button']")
    .forEach((el) => add(el, 65, "rac-pressable"));

  // --- Structural: nav/header items with hidden submenus ---
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
      const trigger =
        el.querySelector<HTMLElement>("a, button, [role='button']") || el;
      add(trigger, 70, "nav-submenu");
    });

  // --- Cursor: pointer + button-shaped non-native element (last, cheapest signal) ---
  let cursorScanned = 0;
  const cursorRoots = document.querySelectorAll<HTMLElement>("div, span, li, section");
  for (const el of cursorRoots) {
    if (cursorScanned++ > 4000) break;
    if (isNative(el)) continue;
    const cs = window.getComputedStyle(el);
    if (cs.cursor !== "pointer") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 24 || rect.width > 400) continue;
    if (rect.height < 16 || rect.height > 80) continue;
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 40) continue;
    // Skip if it already contains a higher-priority candidate (button-in-button noise).
    let containsCand = false;
    for (const k of candidates.keys()) {
      if (k !== el && el.contains(k)) {
        containsCand = true;
        break;
      }
    }
    if (containsCand) continue;
    add(el, 60, "cursor-pointer-buttonlike");
  }

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

  // --- Dynamic probing tiebreaker for medium-score candidates ---
  // Only runs when total candidates exceed `cap` (otherwise we'll keep them all
  // anyway). Probes up to ~10 medium-band elements with a synthetic
  // hover+focus, watching a MutationObserver to confirm they trigger DOM changes.
  const MEDIUM_LO = 50;
  const MEDIUM_HI = 70;
  const PER_PROBE_MS = 120;
  const MAX_PROBES = 10;

  if (candidates.size > cap) {
    const definite = Array.from(candidates.values()).filter((c) => c.score > MEDIUM_HI);
    const medium = Array.from(candidates.values())
      .filter((c) => c.score >= MEDIUM_LO && c.score <= MEDIUM_HI)
      .sort((a, b) => b.score - a.score);

    if (definite.length < cap && medium.length > 0) {
      const probeCount = Math.min(MAX_PROBES, cap - definite.length + 4, medium.length);
      const observer = new MutationObserver(() => {});
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "style",
          "class",
          "aria-expanded",
          "aria-hidden",
          "data-state",
          "data-headlessui-state",
          "hidden",
          "open",
        ],
      });

      const dispatchHover = (el: HTMLElement, x: number, y: number): void => {
        const opts: MouseEventInit = {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window,
        };
        el.dispatchEvent(new PointerEvent("pointerover", { ...opts, pointerType: "mouse" }));
        el.dispatchEvent(new PointerEvent("pointerenter", { ...opts, pointerType: "mouse" }));
        el.dispatchEvent(new MouseEvent("mouseover", opts));
        el.dispatchEvent(new MouseEvent("mouseenter", opts));
        el.dispatchEvent(new MouseEvent("mousemove", opts));
      };

      const clearHoverInline = (): void => {
        const hovered = Array.from(
          document.querySelectorAll<HTMLElement>(":hover"),
        ).reverse();
        const opts: MouseEventInit = {
          bubbles: true,
          cancelable: true,
          clientX: -1,
          clientY: -1,
          view: window,
        };
        for (const el of hovered) {
          el.dispatchEvent(new MouseEvent("mouseout", opts));
          el.dispatchEvent(new MouseEvent("mouseleave", opts));
          el.dispatchEvent(new PointerEvent("pointerout", { ...opts, pointerType: "mouse" }));
          el.dispatchEvent(new PointerEvent("pointerleave", { ...opts, pointerType: "mouse" }));
        }
        document.body.dispatchEvent(new MouseEvent("mousemove", opts));
      };

      try {
        for (let i = 0; i < probeCount; i++) {
          const cand = medium[i];
          observer.takeRecords();
          const rect = cand.el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          try {
            dispatchHover(cand.el, cx, cy);
            cand.el.focus({ preventScroll: true });
          } catch {
            // ignore
          }
          await new Promise((r) => setTimeout(r, PER_PROBE_MS));
          const mutated = observer.takeRecords().length > 0;
          cand.score += mutated ? 15 : -10;

          // Cleanup so probes don't compound.
          try {
            clearHoverInline();
            (document.activeElement as HTMLElement | null)?.blur?.();
          } catch {
            // ignore
          }
        }
      } finally {
        observer.disconnect();
      }
    }
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
