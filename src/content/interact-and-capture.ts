/**
 * Content-script functions for interacting with page elements.
 * Designed for chrome.scripting.executeScript injection — each
 * function must be fully self-contained.
 */

/**
 * Click an element found via CSS selector. Returns true if an element
 * was found and clicked, false otherwise.
 */
export function clickBySelector(selector: string): boolean {
  try {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    // Scroll element into view first
    el.scrollIntoView({ block: "center", behavior: "auto" });

    // Dispatch a real-ish click sequence
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: cx, clientY: cy }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: cx, clientY: cy }));
    el.click();
    return true;
  } catch {
    return false;
  }
}

/**
 * Click the element at the given viewport coordinates. Falls back to
 * dispatching a click event at the point. Returns true if an element
 * was found and clicked.
 */
export function clickAtPoint(coords: { x: number; y: number }): boolean {
  try {
    const el = document.elementFromPoint(coords.x, coords.y) as HTMLElement | null;
    if (!el) return false;

    // Scroll element into view
    el.scrollIntoView({ block: "center", behavior: "auto" });

    // Dispatch click sequence
    el.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: coords.x, clientY: coords.y }),
    );
    el.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, clientX: coords.x, clientY: coords.y }),
    );
    el.click();
    return true;
  } catch {
    return false;
  }
}
