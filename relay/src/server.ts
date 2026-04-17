/**
 * Auto Screenshotter MCP relay.
 *
 * HTTP:
 *   POST /mcp/:userId         — JSON-RPC MCP requests from the AI client
 *   GET  /mcp/:userId         — SSE channel for server-initiated events
 *   GET  /healthz             — liveness
 *
 * WebSocket:
 *   /ws?id=:userId            — persistent connection from the Chrome extension
 *
 * The relay holds no user data. Zips are saved inside the extension via
 * chrome.downloads and never transit this process.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { WebSocketServer, type WebSocket } from "ws";
import { URL } from "url";
import {
  addSSEClient,
  broadcastSSE,
  getUser,
  removeSSEClient,
  setWs,
} from "./store.js";
import { handleJsonRpc, type JsonRpcRequest } from "./mcp-handler.js";

const PORT = Number(process.env.PORT ?? 3848);
const HOST = process.env.HOST ?? "127.0.0.1";

const httpServer = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    console.error("[relay] error handling request", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("internal error");
    }
  }
});

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // CORS for browser-side clients (Claude.ai custom connectors, etc.)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "auto-screenshotter-relay" }));
    return;
  }

  const mcpMatch = url.pathname.match(/^\/mcp\/([A-Za-z0-9_-]+)\/?$/);
  if (mcpMatch) {
    const userId = mcpMatch[1];
    if (req.method === "POST") return handleMcpPost(userId, req, res);
    if (req.method === "GET") return handleMcpSse(userId, req, res);
    res.writeHead(405);
    res.end("method not allowed");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
}

async function handleMcpPost(
  userId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  let parsed: JsonRpcRequest | JsonRpcRequest[];
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid json", detail: String(err) }));
    return;
  }

  if (Array.isArray(parsed)) {
    // JSON-RPC batch (rare for MCP, but support it).
    const responses = await Promise.all(parsed.map((r) => handleJsonRpc(userId, r)));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(responses));
    return;
  }

  const response = await handleJsonRpc(userId, parsed);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(response));
}

function handleMcpSse(
  userId: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write(`: connected\n\n`);
  addSSEClient(userId, res);

  const keepAlive = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* */
    }
  }, 20_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    removeSSEClient(userId, res);
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---- WebSocket: extension tunnel ----

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const userId = url.searchParams.get("id");
  if (!userId || !/^[A-Za-z0-9_-]+$/.test(userId)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    attachExtensionWs(userId, ws);
  });
});

function attachExtensionWs(userId: string, ws: WebSocket): void {
  console.log(`[relay] extension connected: ${userId}`);
  const user = getUser(userId);

  // If the user already had a ws, close the previous one — new connection wins.
  if (user.ws && user.ws !== ws) {
    try {
      user.ws.close();
    } catch {
      /* */
    }
  }
  setWs(userId, ws);

  ws.on("message", (raw) => {
    let msg: unknown;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;
    const env = msg as { type: string };

    if (env.type === "tool_result") {
      const { rpcId, ok, content, error } = msg as unknown as {
        rpcId: string;
        ok: boolean;
        content?: Array<{ type: "text"; text: string }>;
        error?: string;
      };
      const pending = user.pendingCalls.get(rpcId);
      if (pending) {
        clearTimeout(pending.timer);
        user.pendingCalls.delete(rpcId);
        pending.resolve({ ok, content, error });
      }
      return;
    }

    if (env.type === "job_event") {
      // Forward to any SSE subscribers as an MCP notification-ish payload.
      broadcastSSE(userId, msg);
      return;
    }

    if (env.type === "pong") return;
  });

  ws.on("close", () => {
    console.log(`[relay] extension disconnected: ${userId}`);
    if (user.ws === ws) setWs(userId, undefined);
    // Fail any still-pending calls so the AI client gets an error rather than hanging.
    for (const [rpcId, pending] of user.pendingCalls) {
      clearTimeout(pending.timer);
      pending.reject(new Error("extension disconnected"));
      user.pendingCalls.delete(rpcId);
    }
  });

  ws.on("error", (err) => {
    console.warn(`[relay] ws error for ${userId}`, err);
  });

  // Kick a ping immediately so the extension knows we're alive.
  try {
    ws.send(JSON.stringify({ type: "ping" }));
  } catch {
    /* */
  }
}

httpServer.listen(PORT, HOST, () => {
  console.log(`[relay] listening on http://${HOST}:${PORT}`);
  console.log(`[relay]   - POST /mcp/:userId   (JSON-RPC MCP)`);
  console.log(`[relay]   - GET  /mcp/:userId   (SSE events)`);
  console.log(`[relay]   - WS   /ws?id=:userId (extension tunnel)`);
});
