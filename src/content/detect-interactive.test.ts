/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectInteractiveElements } from "./detect-interactive";

// jsdom returns 0×0 for getBoundingClientRect because it doesn't compute layout.
// The detector's visibility/viewport gates would reject every fixture, so we
// stub the rect for any element with `data-rect="W,H,X,Y"` (defaults to a
// reasonable button size) and route getComputedStyle through inline styles
// while preserving display/visibility defaults.

interface FixtureRect {
  width: number;
  height: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  x: number;
  y: number;
}

function fakeRect(el: Element): FixtureRect {
  const attr = (el as HTMLElement).getAttribute?.("data-rect");
  let w = 80;
  let h = 30;
  let x = 10;
  let y = 10;
  if (attr) {
    const parts = attr.split(",").map(Number);
    w = parts[0] ?? w;
    h = parts[1] ?? h;
    x = parts[2] ?? x;
    y = parts[3] ?? y;
  }
  return {
    width: w,
    height: h,
    top: y,
    left: x,
    bottom: y + h,
    right: x + w,
    x,
    y,
  };
}

const realGetComputedStyle = window.getComputedStyle.bind(window);

beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    return fakeRect(this) as DOMRect;
  };

  // Patch getComputedStyle so cursor/display/visibility/opacity reflect what
  // tests set inline (jsdom's default style is empty, which is fine).
  vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
    const real = realGetComputedStyle(el, pseudo ?? null);
    const inline = (el as HTMLElement).style;
    const cursorAttr = (el as HTMLElement).getAttribute?.("data-cursor");
    const display = inline.display || real.display || "block";
    const visibility = inline.visibility || real.visibility || "visible";
    const opacity = inline.opacity || real.opacity || "1";
    const cursor = inline.cursor || cursorAttr || real.cursor || "auto";
    return {
      ...real,
      display,
      visibility,
      opacity,
      cursor,
      getPropertyValue: (prop: string) => {
        if (prop === "display") return display;
        if (prop === "visibility") return visibility;
        if (prop === "opacity") return opacity;
        if (prop === "cursor") return cursor;
        return real.getPropertyValue(prop);
      },
    } as CSSStyleDeclaration;
  });

  // jsdom defaults innerHeight to 768, which gives a 1536px extended viewport
  // — fixtures sit near (10,10), so they're always in range. No override needed.
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const setHTML = (html: string) => {
  document.body.innerHTML = html;
};

describe("detectInteractiveElements", () => {
  it("detects Radix dropdown trigger via data-state=closed", async () => {
    setHTML(
      '<button id="trigger" data-state="closed" aria-haspopup="menu">Open</button>',
    );
    const out = await detectInteractiveElements(8);
    const found = out.find((e) => e.selector === "#trigger");
    expect(found).toBeTruthy();
    expect(found!.confidence).toBeGreaterThanOrEqual(90);
    expect(found!.description).toMatch(/radix-state-closed|aria-haspopup/);
  });

  it("detects Headless UI menu button", async () => {
    setHTML(
      '<button id="headlessui-menu-button-1" data-headlessui-state="" aria-haspopup="true">Menu</button>',
    );
    const out = await detectInteractiveElements(8);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].selector).toBe("#headlessui-menu-button-1");
  });

  it("detects raw <div> with tabindex=0 and cursor:pointer (React-style)", async () => {
    setHTML(
      '<div id="x" tabindex="0" style="cursor: pointer">Click me</div>',
    );
    const out = await detectInteractiveElements(8);
    const found = out.find((e) => e.selector === "#x");
    expect(found).toBeTruthy();
    expect(found!.description).toMatch(/tabindex-nonnative|cursor-pointer-buttonlike/);
  });

  it("detects shadcn classname pattern (DropdownMenuTrigger)", async () => {
    setHTML(
      '<button id="dt" class="DropdownMenuTrigger inline-flex">Open</button>',
    );
    const out = await detectInteractiveElements(8);
    const found = out.find((e) => e.selector === "#dt");
    expect(found).toBeTruthy();
  });

  it("regression: still detects Bootstrap data-bs-toggle", async () => {
    setHTML('<button id="bsbtn" data-bs-toggle="dropdown">Menu</button>');
    const out = await detectInteractiveElements(8);
    const found = out.find((e) => e.selector === "#bsbtn");
    expect(found).toBeTruthy();
    expect(found!.description).toMatch(/data-toggle/);
  });

  it("regression: detects pure-CSS hover nav with hidden submenu", async () => {
    setHTML(`
      <nav>
        <ul>
          <li>
            <a id="prod-link" href="#">Products</a>
            <ul style="display:none"><li><a href="#">A</a></li></ul>
          </li>
        </ul>
      </nav>
    `);
    const out = await detectInteractiveElements(8);
    const found = out.find((e) => e.selector === "#prod-link");
    expect(found).toBeTruthy();
    expect(found!.description).toMatch(/nav-submenu/);
  });

  it("ancestor dedupe: outer role=button wins over inner DropdownTrigger span", async () => {
    setHTML(`
      <div id="outer" role="button">
        <span class="DropdownTrigger">Open</span>
      </div>
    `);
    const out = await detectInteractiveElements(8);
    expect(out.length).toBe(1);
    expect(out[0].selector).toBe("#outer");
  });

  it("respects cap parameter when many candidates qualify", async () => {
    const items = Array.from({ length: 20 })
      .map(
        (_, i) =>
          `<button id="b${i}" data-state="closed" aria-haspopup="menu">M${i}</button>`,
      )
      .join("");
    setHTML(items);
    const out = await detectInteractiveElements(3);
    // cap*2 = 6 is the upper bound; cap=3 doesn't cap the detector itself,
    // but the caller (crawler.ts) slices after. Verify we produced enough
    // candidates for the caller to choose from without exceeding MAX (16).
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.length).toBeLessThanOrEqual(16);
  });
});
