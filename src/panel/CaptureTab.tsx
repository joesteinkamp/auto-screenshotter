import type { CrawlOptions, CrawlState, ExtensionSettings } from "../types";
import CrawlForm from "./CrawlForm";
import ProgressView from "./ProgressView";

interface Props {
  state: CrawlState | null;
  settings: ExtensionSettings | null;
  onStart: (options: CrawlOptions) => void;
  onCancel: () => void;
  onDownload: () => void;
}

export default function CaptureTab({
  state,
  settings,
  onStart,
  onCancel,
  onDownload,
}: Props) {
  const isRunning = state?.status.state === "running";

  return (
    <>
      {!isRunning && (
        <CrawlForm defaults={settings} onStart={onStart} disabled={false} />
      )}

      {state && state.status.state !== "idle" && (
        <ProgressView state={state} onCancel={onCancel} onDownload={onDownload} />
      )}
    </>
  );
}
