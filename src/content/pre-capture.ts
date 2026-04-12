/**
 * Self-contained pre-capture hygiene function. Designed for
 * chrome.scripting.executeScript({ func: preCapturePage }).
 *
 * Best-effort cleanup before a screenshot:
 *   - Dismiss common cookie banners
 *   - Close visible newsletter/signup modals
 *   - Scroll to top
 *
 * Returns after a short settle delay so animations can finish.
 */

export async function preCapturePage(): Promise<{ dismissedBanners: number }> {
  let dismissed = 0;

  const clickIfVisible = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    const rect = (el as HTMLElement).getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    try {
      (el as HTMLElement).click();
      return true;
    } catch {
      return false;
    }
  };

  // Well-known cookie banner selectors — accept/reject buttons
  const SELECTORS: string[] = [
    // OneTrust
    "#onetrust-accept-btn-handler",
    "#onetrust-reject-all-handler",
    // Cookiebot
    "#CybotCookiebotDialogBodyButtonAccept",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    // Didomi
    "#didomi-notice-agree-button",
    // Generic — buttons inside cookie/consent banners
    "[id*='cookie'] button",
    "[class*='cookie'] button",
    "[id*='consent'] button",
    "[class*='consent'] button",
  ];

  for (const sel of SELECTORS) {
    try {
      const candidates = Array.from(document.querySelectorAll(sel));
      for (const el of candidates) {
        const text = (el.textContent || "").trim().toLowerCase();
        if (
          text.includes("accept") ||
          text.includes("agree") ||
          text.includes("allow") ||
          text.includes("got it") ||
          text.includes("ok") ||
          text.includes("reject") ||
          text.includes("decline")
        ) {
          if (clickIfVisible(el)) {
            dismissed++;
            break;
          }
        }
      }
    } catch {
      // selector might be invalid on some pages; ignore
    }
  }

  // Close common modal close buttons (conservative)
  try {
    const closers = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[class*='modal'] [aria-label*='close' i], [class*='modal'] [aria-label*='dismiss' i], [role='dialog'] [aria-label*='close' i]",
      ),
    );
    for (const el of closers.slice(0, 3)) {
      if (clickIfVisible(el)) dismissed++;
    }
  } catch {
    // ignore
  }

  window.scrollTo({ top: 0, behavior: "auto" });

  // Short settle delay
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  return { dismissedBanners: dismissed };
}
