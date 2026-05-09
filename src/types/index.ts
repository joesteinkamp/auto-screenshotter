/**
 * Shared types for the Auto Screenshotter extension.
 */

export type ScrollBehavior = "combine" | "separate" | "none";

export interface CrawlOptions {
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  sameOriginOnly: boolean;
  useLlm: boolean;
  requestDelayMs: number;
  scrollBehavior: ScrollBehavior;
  /** Hover/click probes to capture per page. Defaults to 5 when omitted. */
  maxInteractionsPerPage?: number;
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

/**
 * An interactive element on a page — identified by either DOM heuristics
 * or vision AI — that may reveal new visual state when hovered or clicked.
 */
export interface InteractiveElement {
  /** CSS selector to locate the element in the DOM. */
  selector: string;
  /** Short human-readable description, e.g. "hamburger menu icon". */
  description: string;
  /** Viewport X coordinate (CSS px) of the element center. */
  x: number;
  /** Viewport Y coordinate (CSS px) of the element center. */
  y: number;
  /** Where this candidate came from. Optional for back-compat. */
  source?: "heuristic" | "llm";
  /** Heuristic score (higher = more confident). Optional. */
  confidence?: number;
}

export interface CapturedPageFigmaResult {
  ok: boolean;
  error?: string;
  fileUrl?: string;
}

export interface CapturedPage {
  url: string;
  title: string;
  score: number;
  capturedAt: number;
  order: number;
  /** Screenshot stored in IndexedDB under this key */
  blobKey: string;
  /** Keys of multiple screenshots if separated */
  blobKeys?: string[];
  /** Hash of page text for content dedup */
  contentHash: string;
  thumbnailDataUrl?: string;
  /** Outcome of the optional "send to Figma" step. */
  figma?: CapturedPageFigmaResult;
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
  /** Non-null when the current crawl was started from an MCP tool call. */
  jobId: string | null;
  /**
   * Figma file URL the crawl is targeting. Set when figma mode is enabled
   * and either the user configured a default file URL or the first capture
   * created/returned a file URL we're now chaining into.
   */
  figmaFileUrl?: string;
}

// ---- Jobs (MCP-triggered or panel-triggered) ----

export type JobKind = "screenshot_urls" | "crawl_site" | "panel";

export interface Job {
  id: string;
  kind: JobKind;
  createdAt: number;
  finishedAt?: number;
  status: CrawlStatus;
  pageCount: number;
  totalCount?: number;
  currentUrl?: string;
  zipFilename?: string;
  errorMessage?: string;
  /** Last time the job's state mutated. Used for long-polling. */
  updatedAt: number;
}

export interface JobSummary {
  id: string;
  kind: JobKind;
  status: CrawlStatus;
  pageCount: number;
  createdAt: number;
  finishedAt?: number;
  zipFilename?: string;
}

/**
 * Context threaded from mcp-bridge through the crawler. Identifies the job
 * and the dedicated tab opened for it.
 */
export interface JobContext {
  jobId: string;
  /** Tab to drive. For MCP jobs this is a tab the bridge created specifically for the job. */
  tabId: number;
  /** True when the bridge created a dedicated tab and wants the crawler to close it on finish. */
  ownsTab: boolean;
}

// ---- MCP / relay envelope shapes ----

export type MCPStatus = "disconnected" | "connecting" | "connected" | "disabled";

export interface MCPConnectionInfo {
  status: MCPStatus;
  userId: string;
  endpointUrl: string;
  relayUrl: string;
  enabled: boolean;
  lastError?: string;
}

export interface RelayToolCallEnvelope {
  type: "tool_call";
  rpcId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface RelayPingEnvelope {
  type: "ping";
}

export type RelayInbound = RelayToolCallEnvelope | RelayPingEnvelope;

export interface RelayToolResultOkEnvelope {
  type: "tool_result";
  rpcId: string;
  ok: true;
  content: Array<{ type: "text"; text: string }>;
}

export interface RelayToolResultErrEnvelope {
  type: "tool_result";
  rpcId: string;
  ok: false;
  error: string;
}

export interface RelayJobEventEnvelope {
  type: "job_event";
  jobId: string;
  status: CrawlStatus;
  pageCount: number;
  currentUrl?: string;
  zipFilename?: string;
  errorMessage?: string;
}

export interface RelayPongEnvelope {
  type: "pong";
}

export type RelayOutbound =
  | RelayToolResultOkEnvelope
  | RelayToolResultErrEnvelope
  | RelayJobEventEnvelope
  | RelayPongEnvelope;

// Message types for chrome.runtime messaging
export type BackgroundMessage =
  | { type: "crawl/start"; options: CrawlOptions }
  | { type: "crawl/cancel" }
  | { type: "crawl/getState" }
  | { type: "crawl/download" }
  | { type: "mcp/getStatus" }
  | { type: "mcp/setEnabled"; enabled: boolean }
  | { type: "jobs/list" };

export type BackgroundResponse =
  | { ok: true; state?: CrawlState; mcp?: MCPConnectionInfo; jobs?: JobSummary[] }
  | { ok: false; error: string };

export type PanelEvent =
  | { type: "state/update"; state: CrawlState }
  | { type: "mcp/status"; info: MCPConnectionInfo }
  | { type: "jobs/update"; jobs: JobSummary[] };

/** @deprecated Use PanelEvent. Kept as alias for any lingering imports. */
export type PopupEvent = PanelEvent;

export type AiProvider = "anthropic" | "openai" | "gemini";

export interface ProviderSettings {
  /** API key for this provider. Empty string means "not configured". */
  apiKey: string;
  /** Optional model override; when empty the provider's default is used. */
  model: string;
}

export type FigmaCaptureType = "standard" | "designSystem";

export interface FigmaModeSettings {
  /** Toggle the whole feature. When false the crawler skips the Figma bridge entirely. */
  enabled: boolean;
  /** ID of the installed web-to-figma extension to send messages to. */
  extensionId: string;
  /** Which web-to-figma flow to use. */
  defaultCaptureType: FigmaCaptureType;
  /**
   * Optional Figma file URL. When set, ALL captures (including the first)
   * are routed into this file. Maps to web-to-figma's `fileUrl` field.
   */
  defaultFileUrl: string;
  /**
   * When true (default), the file URL returned by the first successful capture
   * is reused as `fileUrl` for every subsequent page in the same crawl, so
   * one crawl produces one Figma file.
   */
  chainCaptures: boolean;
}

export interface ExtensionSettings {
  /** Which provider to call when "Capture menus & other dynamic page states" is enabled. */
  aiProvider: AiProvider;
  /** Per-provider API keys and model overrides. */
  providers: Record<AiProvider, ProviderSettings>;
  defaultMaxPages: number;
  defaultMaxDepth: number;
  defaultRequestDelayMs: number;
  defaultScrollBehavior: ScrollBehavior;
  /** Cap on hover/click probes captured per page (3-12). */
  defaultMaxInteractionsPerPage: number;
  /** Optional "send each captured page to Figma via web-to-figma" flow. */
  figmaMode: FigmaModeSettings;
  /**
   * @deprecated Use `providers.anthropic.apiKey` instead. Kept for one-shot
   * migration from older installs.
   */
  anthropicApiKey?: string;
}
