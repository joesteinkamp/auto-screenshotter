/**
 * Typed wrappers around chrome.runtime messaging.
 */

import type { BackgroundMessage, BackgroundResponse, PopupEvent } from "../types";

export async function sendToBackground(msg: BackgroundMessage): Promise<BackgroundResponse> {
  return chrome.runtime.sendMessage(msg);
}

export function broadcastToPopup(event: PopupEvent): void {
  // Fire and forget; popup may not be open.
  chrome.runtime.sendMessage(event).catch(() => {
    /* no receiver */
  });
}

export function onPopupEvent(handler: (event: PopupEvent) => void): () => void {
  const listener = (msg: unknown) => {
    const e = msg as PopupEvent;
    if (e && typeof e === "object" && "type" in e && e.type.startsWith("state/")) {
      handler(e);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
