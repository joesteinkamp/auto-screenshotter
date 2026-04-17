/**
 * Hand-rolled JSON-RPC 2.0 dispatcher for MCP. Implements the minimal surface
 * a client needs: `initialize`, `tools/list`, `tools/call`.
 *
 * Tool calls are delegated to the extension by sending a `tool_call` envelope
 * over the WS; we hold the JSON-RPC response open until the extension replies
 * with a `tool_result`, or until a timeout elapses.
 */

import { randomUUID } from "crypto";
import { getUser, type ToolResultPayload } from "./store.js";

const TOOL_CALL_TIMEOUT_MS = 5 * 60_000; // 5 minutes — short tool calls ack fast; long ones are polled via get_job_status.

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number | string | null; result: unknown }
  | { jsonrpc: "2.0"; id: number | string | null; error: { code: number; message: string; data?: unknown } };

const SERVER_INFO = {
  name: "auto-screenshotter",
  version: "0.1.0",
};

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "screenshot_urls",
    description:
      "Screenshot a list of URLs using the user's logged-in Chrome session. Captures full-page images and, when useLlm is true, additionally captures each dynamic UI state (dropdowns, menus, modals) identified by vision AI. Returns immediately with a jobId; poll get_job_status to track progress. On completion the zip is auto-saved to the user's Downloads folder.",
    inputSchema: {
      type: "object",
      required: ["urls"],
      properties: {
        urls: {
          type: "array",
          items: { type: "string", format: "uri" },
          description: "URLs to screenshot, in order.",
        },
        useLlm: {
          type: "boolean",
          description:
            "When true, uses the AI provider configured in the extension to find and capture dynamic page states (menus, dropdowns, modals). Requires an API key set in extension settings.",
          default: false,
        },
        scrollBehavior: {
          type: "string",
          enum: ["combine", "separate", "none"],
          description:
            "combine: scroll and stitch a single full-page PNG per URL (default). separate: one PNG per viewport tile. none: viewport only.",
          default: "combine",
        },
      },
    },
  },
  {
    name: "crawl_site",
    description:
      "Crawl a website starting from a seed URL, follow the highest-scoring links, and screenshot the pages that matter (nav pages, primary CTAs, product/pricing pages, etc.). Returns immediately with a jobId; poll get_job_status to track progress. On completion the zip is auto-saved to the user's Downloads folder.",
    inputSchema: {
      type: "object",
      required: ["startUrl"],
      properties: {
        startUrl: { type: "string", format: "uri" },
        maxPages: { type: "number", default: 25, minimum: 1, maximum: 200 },
        maxDepth: { type: "number", default: 3, minimum: 1, maximum: 10 },
        sameOriginOnly: { type: "boolean", default: true },
        useLlm: { type: "boolean", default: false },
        scrollBehavior: {
          type: "string",
          enum: ["combine", "separate", "none"],
          default: "combine",
        },
      },
    },
  },
  {
    name: "get_job_status",
    description:
      "Get the current status of a capture job. Pass waitForChange: true to long-poll (up to 60s) for the next state change — useful for streaming progress. Without jobId, returns the most recent job. When a job is complete, the text includes the path of the zip saved to the user's Downloads folder.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        waitForChange: { type: "boolean", default: false },
        sinceTs: {
          type: "number",
          description: "Return immediately if the job has updated after this timestamp.",
        },
      },
    },
  },
];

export async function handleJsonRpc(userId: string, req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const id = req.id ?? null;
  try {
    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        };

      case "notifications/initialized":
        // Clients send this after `initialize`. No response needed; returning a result is harmless.
        return { jsonrpc: "2.0", id, result: {} };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: TOOLS },
        };

      case "tools/call": {
        const params = req.params as { name?: unknown; arguments?: unknown } | undefined;
        const name = typeof params?.name === "string" ? params.name : "";
        const args = (params?.arguments ?? {}) as Record<string, unknown>;
        if (!TOOLS.find((t) => t.name === name)) {
          return rpcError(id, -32601, `Unknown tool: ${name}`);
        }
        const payload = await dispatchToolCall(userId, name, args);
        if (payload.ok) {
          return {
            jsonrpc: "2.0",
            id,
            result: { content: payload.content ?? [], isError: false },
          };
        }
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: payload.error ?? "unknown error" }],
            isError: true,
          },
        };
      }

      case "ping":
        return { jsonrpc: "2.0", id, result: {} };

      default:
        return rpcError(id, -32601, `Method not found: ${req.method}`);
    }
  } catch (err) {
    return rpcError(id, -32603, err instanceof Error ? err.message : String(err));
  }
}

function rpcError(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function dispatchToolCall(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolResultPayload> {
  const user = getUser(userId);
  if (!user.ws || user.ws.readyState !== 1 /* OPEN */) {
    return {
      ok: false,
      error:
        "Auto Screenshotter extension is not connected. Open Chrome, open the extension side panel, and enable MCP on the MCP tab.",
    };
  }

  const rpcId = randomUUID();
  const envelope = { type: "tool_call", rpcId, tool, args };

  return await new Promise<ToolResultPayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      user.pendingCalls.delete(rpcId);
      reject(new Error(`tool_call timed out after ${TOOL_CALL_TIMEOUT_MS}ms`));
    }, TOOL_CALL_TIMEOUT_MS);
    user.pendingCalls.set(rpcId, { resolve, reject, timer });
    try {
      user.ws!.send(JSON.stringify(envelope));
    } catch (err) {
      clearTimeout(timer);
      user.pendingCalls.delete(rpcId);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }).catch((err: Error) => ({ ok: false, error: err.message }));
}

export const __TEST__ = { TOOLS };
