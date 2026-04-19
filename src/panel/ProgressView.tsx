import type { CrawlState } from "../types";

interface Props {
  state: CrawlState;
  onCancel: () => void;
  onDownload: () => void;
}

export default function ProgressView({ state, onCancel, onDownload }: Props) {
  const { status, pages } = state;
  const isRunning = status.state === "running";
  const canDownload = pages.length > 0 && !isRunning;
  const totalScreenshots = pages.reduce(
    (sum, p) => sum + (p.blobKeys?.length || 1),
    0,
  );

  return (
    <div className="section">
      <div className="progress">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusBadge state={status.state} />
          <span style={{ color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
            <strong style={{ color: "var(--text)", fontWeight: 600 }}>{totalScreenshots}</strong>{" "}
            captured
            {isRunning && status.state === "running" && (
              <span style={{ color: "var(--muted)" }}> · {status.queueSize} in queue</span>
            )}
          </span>
        </div>
        {isRunning && status.state === "running" && (
          <div className="current">→ {status.currentUrl}</div>
        )}
        {status.state === "error" && (
          <div className="current" style={{ color: "var(--danger)" }}>
            {status.message}
          </div>
        )}
      </div>

      {pages.length > 0 && (
        <div className="page-list">
          {pages
            .slice()
            .reverse()
            .map((page) => (
              <div key={page.blobKey} className="page-item">
                {page.thumbnailDataUrl ? (
                  <img src={page.thumbnailDataUrl} alt="" />
                ) : (
                  <div style={{ width: 48, height: 32, background: "#000", borderRadius: 3 }} />
                )}
                <div className="meta">
                  <div className="title">{page.title || page.url}</div>
                  <div className="url">{page.url}</div>
                </div>
                <div className="score">{page.score}</div>
              </div>
            ))}
        </div>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        {isRunning ? (
          <button className="danger" onClick={onCancel}>Cancel</button>
        ) : (
          <button className="primary" onClick={onDownload} disabled={!canDownload}>
            Download ZIP
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ state }: { state: string }) {
  const label = state[0].toUpperCase() + state.slice(1);
  return <span className={`status-badge ${state}`}>{label}</span>;
}
