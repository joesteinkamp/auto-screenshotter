import { useState } from "react";
import type { MCPConnectionInfo, MCPStatus } from "../types";
import { CheckIcon, CopyIcon } from "./Icons";

interface Props {
  info: MCPConnectionInfo | null;
  onToggle: (enabled: boolean) => void;
  onRelayOverride: (url: string) => void;
}

const STATUS_LABEL: Record<MCPStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting…",
  connected: "Connected",
  disabled: "Disabled",
};

export default function McpTab({ info, onToggle, onRelayOverride }: Props) {
  const [relayDraft, setRelayDraft] = useState("");
  const [editingRelay, setEditingRelay] = useState(false);

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

      <label style={{ marginTop: 14 }}>Relay URL</label>
      {editingRelay ? (
        <div className="row" style={{ gap: 6 }}>
          <input
            type="text"
            value={relayDraft}
            placeholder="ws://localhost:3848"
            onChange={(e) => setRelayDraft(e.target.value)}
          />
          <button
            className="primary"
            onClick={() => {
              onRelayOverride(relayDraft.trim());
              setEditingRelay(false);
            }}
          >
            Save
          </button>
          <button onClick={() => setEditingRelay(false)}>Cancel</button>
        </div>
      ) : (
        <div className="row" style={{ gap: 6 }}>
          <code style={{ flex: 1, fontSize: 11, color: "var(--muted)" }}>{info.relayUrl}</code>
          <button
            onClick={() => {
              setRelayDraft(info.relayUrl);
              setEditingRelay(true);
            }}
          >
            Change
          </button>
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
        Default <code>ws://localhost:3848</code>. Change only if you run the relay on a different port.
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 16, lineHeight: 1.5 }}>
        Start the relay once with <code>cd relay &amp;&amp; npm install &amp;&amp; npm run dev</code>,
        then enable MCP here. Your zips stay local — the relay is just a protocol bridge.
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
