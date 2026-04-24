import type { CrawlOptions, CrawlState, ExtensionSettings } from "../types";
import CrawlForm from "./CrawlForm";
import ProgressView from "./ProgressView";

interface Props {
  state: CrawlState | null;
  settings: ExtensionSettings | null;
  onStart: (options: CrawlOptions) => void;
  onCaptureCurrent: () => void;
  onCancel: () => void;
  onDownload: () => void;
}

export default function CaptureTab({
  state,
  settings,
  onStart,
  onCaptureCurrent,
  onCancel,
  onDownload,
}: Props) {
  const isRunning = state?.status.state === "running";

  return (
    <>
      {!isRunning && (
        <>
          <div className="section">
            <button
              type="button"
              className="primary"
              style={{ width: "100%" }}
              onClick={onCaptureCurrent}
            >
              Screenshot current page
            </button>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
              Captures the active tab with your default scroll behavior — useful
              for pages the crawler missed or states you set up manually.
            </div>
          </div>
          <CrawlForm defaults={settings} onStart={onStart} disabled={false} />
        </>
      )}

      {state && state.status.state !== "idle" && (
        <ProgressView state={state} onCancel={onCancel} onDownload={onDownload} />
      )}
    </>
  );
}
