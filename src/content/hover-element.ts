/**
 * Content-script hover helpers. Self-contained for injection via
 * chrome.scripting.executeScript.
 */

function dispatchHover(el: HTMLElement, x: number, y: number): void {
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
}

export function hoverBySelector(selector: string): boolean {
  try {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    el.scrollIntoView({ block: "center", behavior: "auto" });
    const r2 = el.getBoundingClientRect();
    dispatchHover(el, r2.left + r2.width / 2, r2.top + r2.height / 2);
    return true;
  } catch {
    return false;
  }
}

export function hoverAtPoint(coords: { x: number; y: number }): boolean {
  try {
    const el = document.elementFromPoint(coords.x, coords.y) as HTMLElement | null;
    if (!el) return false;
    el.scrollIntoView({ block: "center", behavior: "auto" });
    dispatchHover(el, coords.x, coords.y);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move the synthetic pointer off the page and dispatch leave events on any
 * element currently considered hovered (via :hover). Used to collapse
 * hover-revealed menus before the next capture.
 */
export function clearHover(): void {
  try {
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
  } catch {
    // ignore
  }
}
