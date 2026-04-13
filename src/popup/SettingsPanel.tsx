import { useState } from "react";
import type { AiProvider, ExtensionSettings, ProviderSettings } from "../types";
import { saveSettings } from "../lib/storage";
import { DEFAULT_MODELS } from "../scoring/llm-refiner";

interface Props {
  settings: ExtensionSettings;
  onChange: (settings: ExtensionSettings) => void;
}

const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  gemini: "Google Gemini",
};

const PROVIDER_KEY_PLACEHOLDERS: Record<AiProvider, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  gemini: "AIza...",
};

const PROVIDER_KEY_URLS: Record<AiProvider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/app/apikey",
};

export default function SettingsPanel({ settings, onChange }: Props) {
  const [provider, setProvider] = useState<AiProvider>(settings.aiProvider);
  const [providers, setProviders] = useState<Record<AiProvider, ProviderSettings>>(
    settings.providers,
  );
  const [saved, setSaved] = useState(false);

  const current = providers[provider];

  const updateCurrent = (patch: Partial<ProviderSettings>) => {
    setProviders((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], ...patch },
    }));
  };

  const save = async () => {
    const trimmed: Record<AiProvider, ProviderSettings> = {
      anthropic: {
        apiKey: providers.anthropic.apiKey.trim(),
        model: providers.anthropic.model.trim(),
      },
      openai: {
        apiKey: providers.openai.apiKey.trim(),
        model: providers.openai.model.trim(),
      },
      gemini: {
        apiKey: providers.gemini.apiKey.trim(),
        model: providers.gemini.model.trim(),
      },
    };
    const updated: ExtensionSettings = {
      ...settings,
      aiProvider: provider,
      providers: trimmed,
    };
    await saveSettings(updated);
    onChange(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="settings-panel">
      <label htmlFor="ai-provider">AI provider</label>
      <select
        id="ai-provider"
        value={provider}
        onChange={(e) => setProvider(e.target.value as AiProvider)}
      >
        {(Object.keys(PROVIDER_LABELS) as AiProvider[]).map((p) => (
          <option key={p} value={p}>
            {PROVIDER_LABELS[p]}
            {providers[p].apiKey ? " - key saved" : ""}
          </option>
        ))}
      </select>

      <label htmlFor="api-key" style={{ marginTop: 10 }}>
        {PROVIDER_LABELS[provider]} API key
      </label>
      <input
        id="api-key"
        type="password"
        placeholder={PROVIDER_KEY_PLACEHOLDERS[provider]}
        value={current.apiKey}
        onChange={(e) => updateCurrent({ apiKey: e.target.value })}
      />
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
        Stored locally in chrome.storage. Get one at{" "}
        <a
          href={PROVIDER_KEY_URLS[provider]}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--accent)" }}
        >
          {new URL(PROVIDER_KEY_URLS[provider]).hostname}
        </a>
        .
      </div>

      <label htmlFor="model" style={{ marginTop: 10 }}>
        Model (optional)
      </label>
      <input
        id="model"
        type="text"
        placeholder={DEFAULT_MODELS[provider]}
        value={current.model}
        onChange={(e) => updateCurrent({ model: e.target.value })}
      />
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
        Leave blank to use the default ({DEFAULT_MODELS[provider]}).
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={save}>{saved ? "Saved" : "Save"}</button>
      </div>
    </div>
  );
}
