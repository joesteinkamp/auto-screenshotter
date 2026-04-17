/**
 * WebSocket client that connects the extension service worker to a local
 * MCP relay server. The relay translates MCP JSON-RPC from AI clients into
 * `tool_call` envelopes that arrive over this socket.
 *
 * Pattern inherited from chrome-page-designer's relay-client:
 *   - WS URL: `${base}/ws?id=${userId}`
 *   - Exponential backoff reconnect (1s → 2s → 4s → 8s cap)
 *   - 30s ping to keep the socket warm (and the SW alive)
 *   - Random 8-char userId persisted in chrome.storage.sync
 */

import type {
  MCPConnectionInfo,
  MCPStatus,
  RelayInbound,
  RelayOutbound,
} from "../types";
import { broadcastToPanel } from "../lib/messaging";

const DEFAULT_RELAY_URL = "ws://localhost:3848";
const SYNC_USER_ID_KEY = "mcpUserId";
const SYNC_ENABLED_KEY = "mcpEnabled";
const SYNC_RELAY_OVERRIDE_KEY = "mcpRelayUrlOverride";

const PING_INTERVAL_MS = 30_000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 8000;

type CommandHandler = (cmd: RelayInbound) => void;

let socket: WebSocket | null = null;
let status: MCPStatus = "disconnected";
let lastError: string | undefined;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let commandHandler: CommandHandler | null = null;

function randomId(len = 8): string {
  const alpha = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += alpha[bytes[i] % alpha.length];
  return out;
}

async function syncGet<T>(key: string): Promise<T | undefined> {
  const r = await chrome.storage.sync.get(key);
  return r[key] as T | undefined;
}

async function syncSet(key: string, value: unknown): Promise<void> {
  await chrome.storage.sync.set({ [key]: value });
}

export async function getUserId(): Promise<string> {
  const existing = await syncGet<string>(SYNC_USER_ID_KEY);
  if (existing && typeof existing === "string" && existing.length >= 4) return existing;
  const id = randomId(8);
  await syncSet(SYNC_USER_ID_KEY, id);
  return id;
}

export async function getRelayUrl(): Promise<string> {
  const override = await syncGet<string>(SYNC_RELAY_OVERRIDE_KEY);
  if (override && typeof override === "string" && override.length > 0) return override;
  return DEFAULT_RELAY_URL;
}

export async function getRelayEnabled(): Promise<boolean> {
  const val = await syncGet<boolean>(SYNC_ENABLED_KEY);
  return val === true;
}

export async function setRelayEnabled(enabled: boolean): Promise<void> {
  await syncSet(SYNC_ENABLED_KEY, enabled);
  if (enabled) {
    await initRelay();
  } else {
    stopRelay();
    setStatus("disabled");
  }
}

export async function setRelayUrlOverride(url: string): Promise<void> {
  await syncSet(SYNC_RELAY_OVERRIDE_KEY, url);
  if (await getRelayEnabled()) {
    stopRelay();
    await initRelay();
  }
}

export function isRelayConnected(): boolean {
  return status === "connected";
}

export async function getConnectionInfo(): Promise<MCPConnectionInfo> {
  const userId = await getUserId();
  const relayUrl = await getRelayUrl();
  const enabled = await getRelayEnabled();
  return {
    status: enabled ? status : "disabled",
    userId,
    relayUrl,
    endpointUrl: `${httpFromWs(relayUrl)}/mcp/${userId}`,
    enabled,
    lastError,
  };
}

function httpFromWs(wsUrl: string): string {
  if (wsUrl.startsWith("wss://")) return "https://" + wsUrl.slice(6);
  if (wsUrl.startsWith("ws://")) return "http://" + wsUrl.slice(5);
  return wsUrl;
}

function setStatus(next: MCPStatus, err?: string): void {
  status = next;
  lastError = err;
  getConnectionInfo().then((info) => {
    broadcastToPanel({ type: "mcp/status", info });
  });
}

export function onRelayCommand(handler: CommandHandler): void {
  commandHandler = handler;
}

export function sendToRelay(msg: RelayOutbound): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(msg));
  } catch (err) {
    console.warn("[auto-screenshotter] sendToRelay failed", err);
  }
}

export function stopRelay(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (socket) {
    try {
      socket.close();
    } catch {
      /* */
    }
    socket = null;
  }
  reconnectAttempt = 0;
}

export async function initRelay(): Promise<void> {
  const enabled = await getRelayEnabled();
  if (!enabled) {
    setStatus("disabled");
    return;
  }
  await connect();
}

async function connect(): Promise<void> {
  stopRelay();
  const userId = await getUserId();
  const relayUrl = await getRelayUrl();
  const url = `${relayUrl}/ws?id=${encodeURIComponent(userId)}`;

  setStatus("connecting");
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    setStatus("disconnected", err instanceof Error ? err.message : String(err));
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.addEventListener("open", () => {
    reconnectAttempt = 0;
    setStatus("connected");
    pingInterval = setInterval(() => {
      sendToRelay({ type: "pong" });
    }, PING_INTERVAL_MS);
  });

  ws.addEventListener("message", (ev) => {
    let msg: RelayInbound;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (msg.type === "ping") {
      sendToRelay({ type: "pong" });
      return;
    }
    if (commandHandler) commandHandler(msg);
  });

  ws.addEventListener("close", () => {
    socket = null;
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    setStatus("disconnected");
    scheduleReconnect();
  });

  ws.addEventListener("error", (ev) => {
    setStatus("disconnected", "websocket error");
    // close handler will schedule reconnect
    void ev;
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  getRelayEnabled().then((enabled) => {
    if (!enabled) return;
    const delay = Math.min(
      BACKOFF_MAX_MS,
      BACKOFF_BASE_MS * Math.pow(2, reconnectAttempt),
    );
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect().catch((err) => {
        console.warn("[auto-screenshotter] relay reconnect failed", err);
      });
    }, delay);
  });
}
