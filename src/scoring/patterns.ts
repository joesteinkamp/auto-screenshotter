/**
 * Pattern dictionaries for URL + anchor-text heuristic scoring.
 * Patterns are case-insensitive. Path matches look for the pattern
 * anywhere inside the URL pathname.
 */

export interface PatternRule {
  pattern: RegExp;
  score: number;
  label: string;
}

/**
 * URL pathname patterns. Applied via `.test(pathname)`.
 */
export const URL_PATTERNS: PatternRule[] = [
  // Strong positive — core product/flow pages
  { pattern: /^\/?$/, score: 60, label: "homepage" },
  { pattern: /\/(home|index)(\/|$)/, score: 55, label: "home" },
  { pattern: /\/(dashboard|app|console|portal)(\/|$)/, score: 55, label: "app" },
  { pattern: /\/(login|signin|sign-in)(\/|$)/, score: 50, label: "login" },
  { pattern: /\/(signup|register|sign-up|join|get-started)(\/|$)/, score: 55, label: "signup" },
  { pattern: /\/(pricing|plans|subscribe)(\/|$)/, score: 50, label: "pricing" },
  { pattern: /\/(checkout|cart|order)(\/|$)/, score: 50, label: "checkout" },
  { pattern: /\/(onboarding|welcome|tour)(\/|$)/, score: 45, label: "onboarding" },
  { pattern: /\/(features?|product|products)(\/|$)/, score: 40, label: "features" },
  { pattern: /\/(settings|account|profile|preferences)(\/|$)/, score: 40, label: "settings" },
  { pattern: /\/(solutions|use-cases?|why-)(\/|$)/, score: 30, label: "solutions" },
  { pattern: /\/(integrations?|api|developers?)(\/|$)/, score: 25, label: "integrations" },

  // Strong negative — legal/boilerplate
  { pattern: /\/(privacy|privacy-policy)(\/|$)/, score: -80, label: "privacy" },
  { pattern: /\/(terms|tos|terms-of-service|terms-and-conditions)(\/|$)/, score: -80, label: "terms" },
  { pattern: /\/(cookie|cookies|cookie-policy)(\/|$)/, score: -80, label: "cookies" },
  { pattern: /\/(legal|disclaimer|dmca|gdpr|ccpa)(\/|$)/, score: -75, label: "legal" },
  { pattern: /\/(accessibility|a11y)(\/|$)/, score: -60, label: "accessibility" },
  { pattern: /\/(sitemap|robots)(\/|$)/, score: -90, label: "sitemap" },
  { pattern: /\/(security|trust|compliance)(\/|$)/, score: -30, label: "security" },

  // Moderate negative — secondary content
  { pattern: /\/(blog|news|posts?|articles?)(\/|$)/, score: -25, label: "blog" },
  { pattern: /\/(docs?|documentation|reference|guide)(\/|$)/, score: -20, label: "docs" },
  { pattern: /\/(help|support|faq|contact)(\/|$)/, score: -20, label: "help" },
  { pattern: /\/(press|media|newsroom)(\/|$)/, score: -40, label: "press" },
  { pattern: /\/(careers?|jobs?|hiring)(\/|$)/, score: -50, label: "careers" },
  { pattern: /\/(about|team|company|story)(\/|$)/, score: -10, label: "about" },
];

/**
 * Anchor text patterns. Applied via `.test(anchorText.toLowerCase())`.
 */
export const ANCHOR_TEXT_PATTERNS: PatternRule[] = [
  // Positive CTAs
  { pattern: /\b(sign ?up|get started|try (it )?free|start free|create account)\b/, score: 35, label: "cta-signup" },
  { pattern: /\b(log ?in|sign ?in)\b/, score: 25, label: "cta-login" },
  { pattern: /\b(get a demo|book a demo|request demo|schedule)\b/, score: 20, label: "cta-demo" },
  { pattern: /\b(pricing|plans|buy now|purchase)\b/, score: 25, label: "cta-pricing" },
  { pattern: /\b(dashboard|my account|go to app)\b/, score: 30, label: "cta-app" },
  { pattern: /\b(features?|how it works|product tour)\b/, score: 20, label: "cta-features" },

  // Negative — legal/secondary
  { pattern: /\b(privacy( policy)?|terms( of service)?|tos|cookie( policy)?|legal|disclaimer)\b/, score: -60, label: "legal" },
  { pattern: /\b(unsubscribe|rss|sitemap)\b/, score: -70, label: "boilerplate" },
  { pattern: /\b(careers?|jobs?|we'?re hiring)\b/, score: -40, label: "careers" },
  { pattern: /\b(press|media kit|newsroom)\b/, score: -35, label: "press" },
];

/**
 * URL query-string patterns that usually indicate filters/pagination
 * rather than distinct pages. Add a penalty when present.
 */
export const QUERY_PENALTY_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /[?&]page=/, score: -30 },
  { pattern: /[?&]p=\d+/, score: -30 },
  { pattern: /[?&](sort|order|filter|category|tag)=/, score: -20 },
  { pattern: /[?&]utm_/, score: -5 },
  { pattern: /[?&](ref|source|campaign)=/, score: -5 },
];
