import { useState } from "react";
import type { ExtensionSettings } from "../types";
import { saveSettings } from "../lib/storage";

interface Props {
  settings: ExtensionSettings;
  onChange: (settings: ExtensionSettings) => void;
}

export default function SettingsPanel({ settings, onChange }: Props) {
  const [apiKey, setApiKey] = useState(settings.anthropicApiKey);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const updated: ExtensionSettings = { ...settings, anthropicApiKey: apiKey.trim() };
    await saveSettings(updated);
    onChange(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="settings-panel">
      <label htmlFor="api-key">Anthropic API key (optional)</label>
      <input
        id="api-key"
        type="password"
        placeholder="sk-ant-..."
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
        Stored locally in chrome.storage. Used only when &ldquo;Use Claude&rdquo; is checked.
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={save}>{saved ? "Saved" : "Save"}</button>
      </div>
    </div>
  );
}
