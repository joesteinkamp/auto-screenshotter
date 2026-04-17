/**
 * Per-userId state the relay holds in memory: the current extension WS,
 * any SSE subscribers, and pending MCP tool calls waiting on the extension.
 */

import type { WebSocket } from "ws";
import type { ServerResponse } from "http";

export interface PendingCall {
  resolve: (payload: ToolResultPayload) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ToolResultPayload {
  ok: boolean;
  content?: Array<{ type: "text"; text: string }>;
  error?: string;
}

export interface UserState {
  ws?: WebSocket;
  sseClients: Set<ServerResponse>;
  pendingCalls: Map<string, PendingCall>;
}

const users = new Map<string, UserState>();

export function getUser(userId: string): UserState {
  let s = users.get(userId);
  if (!s) {
    s = { sseClients: new Set(), pendingCalls: new Map() };
    users.set(userId, s);
  }
  return s;
}

export function setWs(userId: string, ws: WebSocket | undefined): void {
  const s = getUser(userId);
  s.ws = ws;
}

export function broadcastSSE(userId: string, event: unknown): void {
  const s = getUser(userId);
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of s.sseClients) {
    try {
      client.write(payload);
    } catch {
      /* */
    }
  }
}

export function addSSEClient(userId: string, res: ServerResponse): void {
  getUser(userId).sseClients.add(res);
}

export function removeSSEClient(userId: string, res: ServerResponse): void {
  getUser(userId).sseClients.delete(res);
}
