import { useState } from "react";
import type { MCPConnectionInfo, MCPStatus } from "../types";
import { CheckIcon, CopyIcon } from "./Icons";

interface Props {
  info: MCPConnectionInfo | null;
  onToggle: (enabled: boolean) => void;
}

const STATUS_LABEL: Record<MCPStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
  disabled: "Disabled",
};

export default function McpTab({ info, onToggle }: Props) {
  if (!info) {
    return <div className="section empty-state">Loading MCP status…</div>;
  }

  return (
    <div className="section">
      <div className="mcp-status-row">
        <span className={`status-badge mcp-${info.status}`}>
          {STATUS_LABEL[info.status]}
        </span>
        <label className="toggle">
          <input
            type="checkbox"
            checked={info.enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span>Enable MCP</span>
        </label>
      </div>

      {info.lastError && (
        <div style={{ color: "var(--danger)", fontSize: 11, marginTop: 6 }}>
          {info.lastError}
        </div>
      )}

      <label style={{ marginTop: 14 }}>User ID</label>
      <CopyRow value={info.userId} />

      <label style={{ marginTop: 10 }}>Endpoint URL</label>
      <CopyRow value={info.endpointUrl} />
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
        Point MCP-speaking clients (Cursor, claude.ai custom connectors) at this URL.
      </div>

      <label style={{ marginTop: 14 }}>Claude Code</label>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>
        Run this command in your terminal to register the connector:
      </div>
      <div style={{ marginTop: 6 }}>
        <code style={{ display: "block", fontSize: 11, wordBreak: "break-all" }}>
          claude mcp add --transport http auto-screenshotter {info.endpointUrl}
        </code>
      </div>

      <label style={{ marginTop: 14 }}>Claude Desktop</label>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>
        Open <code>Settings → Connectors → Add custom connector</code> and paste the
        Endpoint URL above.
      </div>
    </div>
  );
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* */
    }
  };
  return (
    <div className="copy-row">
      <code>{value}</code>
      <button className="icon-button" onClick={copy} title="Copy">
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}
