/**
 * Typed wrappers around chrome.runtime messaging.
 */

import type { BackgroundMessage, BackgroundResponse, PanelEvent } from "../types";

export async function sendToBackground(msg: BackgroundMessage): Promise<BackgroundResponse> {
  return chrome.runtime.sendMessage(msg);
}

export function broadcastToPanel(event: PanelEvent): void {
  // Fire and forget; panel may not be open.
  chrome.runtime.sendMessage(event).catch(() => {
    /* no receiver */
  });
}

/** @deprecated Alias for broadcastToPanel. */
export const broadcastToPopup = broadcastToPanel;

const PANEL_EVENT_PREFIXES = ["state/", "mcp/", "jobs/"];

export function onPanelEvent(handler: (event: PanelEvent) => void): () => void {
  const listener = (msg: unknown) => {
    const e = msg as PanelEvent;
    if (
      e &&
      typeof e === "object" &&
      "type" in e &&
      PANEL_EVENT_PREFIXES.some((p) => (e as { type: string }).type.startsWith(p))
    ) {
      handler(e);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/** @deprecated Alias for onPanelEvent. */
export const onPopupEvent = onPanelEvent;
