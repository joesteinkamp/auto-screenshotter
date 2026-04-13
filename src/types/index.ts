/**
 * Shared types for the Auto Screenshotter extension.
 */

export interface CrawlOptions {
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  sameOriginOnly: boolean;
  useLlm: boolean;
  requestDelayMs: number;
}

export interface LinkContext {
  inHeader: boolean;
  inNav: boolean;
  inFooter: boolean;
  isPrimaryCta: boolean;
  isHidden: boolean;
  fontSizePx: number;
  ariaLabel: string | null;
}

export interface ExtractedLink {
  url: string;
  anchorText: string;
  context: LinkContext;
}

export interface ScoredLink {
  url: string;
  score: number;
  depth: number;
  sourceUrl: string;
  anchorText: string;
  context: LinkContext;
}

export interface CapturedPage {
  url: string;
  title: string;
  score: number;
  capturedAt: number;
  order: number;
  /** Screenshot stored in IndexedDB under this key */
  blobKey: string;
  /** Hash of page text for content dedup */
  contentHash: string;
  thumbnailDataUrl?: string;
}

export type CrawlStatus =
  | { state: "idle" }
  | { state: "running"; currentUrl: string; capturedCount: number; queueSize: number }
  | { state: "complete"; capturedCount: number }
  | { state: "cancelled"; capturedCount: number }
  | { state: "error"; message: string; capturedCount: number };

export interface CrawlState {
  options: CrawlOptions;
  status: CrawlStatus;
  pages: CapturedPage[];
  startedAt: number;
}

// Message types for chrome.runtime messaging
export type BackgroundMessage =
  | { type: "crawl/start"; options: CrawlOptions }
  | { type: "crawl/cancel" }
  | { type: "crawl/getState" }
  | { type: "crawl/download" };

export type BackgroundResponse =
  | { ok: true; state?: CrawlState }
  | { ok: false; error: string };

export type PopupEvent =
  | { type: "state/update"; state: CrawlState };

export type AiProvider = "anthropic" | "openai" | "gemini";

export interface ProviderSettings {
  /** API key for this provider. Empty string means "not configured". */
  apiKey: string;
  /** Optional model override; when empty the provider's default is used. */
  model: string;
}

export interface ExtensionSettings {
  /** Which provider to call when "Use AI to rank pages" is enabled. */
  aiProvider: AiProvider;
  /** Per-provider API keys and model overrides. */
  providers: Record<AiProvider, ProviderSettings>;
  defaultMaxPages: number;
  defaultMaxDepth: number;
  defaultRequestDelayMs: number;
  /**
   * @deprecated Use `providers.anthropic.apiKey` instead. Kept for one-shot
   * migration from older installs.
   */
  anthropicApiKey?: string;
}
