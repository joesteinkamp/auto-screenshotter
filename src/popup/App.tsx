import { useEffect, useState } from "react";
import type { CrawlOptions, CrawlState, ExtensionSettings } from "../types";
import { onPopupEvent, sendToBackground } from "../lib/messaging";
import { getSettings } from "../lib/storage";
import CrawlForm from "./CrawlForm";
import ProgressView from "./ProgressView";
import SettingsPanel from "./SettingsPanel";

export default function App() {
  const [state, setState] = useState<CrawlState | null>(null);
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    // Fetch initial state
    sendToBackground({ type: "crawl/getState" }).then((resp) => {
      if (resp.ok && resp.state) setState(resp.state);
    });

    getSettings().then(setSettings);

    // Subscribe to updates
    const unsubscribe = onPopupEvent((event) => {
      if (event.type === "state/update") setState(event.state);
    });
    return unsubscribe;
  }, []);

  const handleStart = async (options: CrawlOptions) => {
    const resp = await sendToBackground({ type: "crawl/start", options });
    if (resp.ok && resp.state) setState(resp.state);
  };

  const handleCancel = async () => {
    const resp = await sendToBackground({ type: "crawl/cancel" });
    if (resp.ok && resp.state) setState(resp.state);
  };

  const handleDownload = async () => {
    const resp = await sendToBackground({ type: "crawl/download" });
    if (!resp.ok) alert(resp.error);
  };

  const isRunning = state?.status.state === "running";

  return (
    <div>
      <h1>Auto Screenshotter</h1>

      {!isRunning && (
        <CrawlForm
          defaults={settings}
          onStart={handleStart}
          disabled={isRunning}
        />
      )}

      {state && state.status.state !== "idle" && (
        <ProgressView
          state={state}
          onCancel={handleCancel}
          onDownload={handleDownload}
        />
      )}

      <div className="section">
        <button className="settings-toggle" onClick={() => setShowSettings((s) => !s)}>
          {showSettings ? "Hide settings" : "Settings"}
        </button>
        {showSettings && settings && (
          <SettingsPanel
            settings={settings}
            onChange={setSettings}
          />
        )}
      </div>
    </div>
  );
}
