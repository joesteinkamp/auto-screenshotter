import { useState } from "react";
import type {
  AiProvider,
  ExtensionSettings,
  FigmaModeSettings,
  ProviderSettings,
} from "../types";
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
  const [figmaMode, setFigmaMode] = useState<FigmaModeSettings>(settings.figmaMode);
  const [maxInteractions, setMaxInteractions] = useState(
    settings.defaultMaxInteractionsPerPage,
  );
  const [saved, setSaved] = useState(false);

  const updateFigma = (patch: Partial<FigmaModeSettings>) => {
    setFigmaMode((prev) => ({ ...prev, ...patch }));
  };

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
      figmaMode: {
        ...figmaMode,
        extensionId: figmaMode.extensionId.trim(),
        defaultFileUrl: figmaMode.defaultFileUrl.trim(),
      },
      defaultMaxInteractionsPerPage: Math.min(12, Math.max(3, maxInteractions)),
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

      <hr style={{ margin: "16px 0", border: "none", borderTop: "1px solid var(--border, #2a2a2a)" }} />

      <label htmlFor="max-interactions">
        Interactive states per page: <strong>{maxInteractions}</strong>
      </label>
      <input
        id="max-interactions"
        type="range"
        min={3}
        max={12}
        step={1}
        value={maxInteractions}
        onChange={(e) => setMaxInteractions(Number(e.target.value))}
        style={{ width: "100%" }}
      />
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
        Hover/click probes captured per page. Higher = more thorough but slower
        (each adds ~3-4s).
      </div>

      <hr style={{ margin: "16px 0", border: "none", borderTop: "1px solid var(--border, #2a2a2a)" }} />

      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="checkbox"
          checked={figmaMode.enabled}
          onChange={(e) => updateFigma({ enabled: e.target.checked })}
        />
        Send captures to Figma (via web-to-figma)
      </label>

      {figmaMode.enabled && (
        <>
          <label htmlFor="figma-ext-id" style={{ marginTop: 10 }}>
            web-to-figma extension ID
          </label>
          <input
            id="figma-ext-id"
            type="text"
            placeholder="32-char extension id"
            value={figmaMode.extensionId}
            onChange={(e) => updateFigma({ extensionId: e.target.value })}
          />
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            Visit chrome://extensions and copy the ID shown under the web-to-figma extension.
          </div>

          <label htmlFor="figma-capture-type" style={{ marginTop: 10 }}>
            Default capture type
          </label>
          <select
            id="figma-capture-type"
            value={figmaMode.defaultCaptureType}
            onChange={(e) =>
              updateFigma({ defaultCaptureType: e.target.value as FigmaModeSettings["defaultCaptureType"] })
            }
          >
            <option value="standard">Standard</option>
            <option value="designSystem">Design system</option>
          </select>

          <label htmlFor="figma-file-url" style={{ marginTop: 10 }}>
            Default Figma file URL (optional)
          </label>
          <input
            id="figma-file-url"
            type="text"
            placeholder="https://www.figma.com/file/..."
            value={figmaMode.defaultFileUrl}
            onChange={(e) => updateFigma({ defaultFileUrl: e.target.value })}
          />
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            When set, every capture lands in this file. Leave blank to create a new file per crawl.
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
            <input
              type="checkbox"
              checked={figmaMode.chainCaptures}
              onChange={(e) => updateFigma({ chainCaptures: e.target.checked })}
            />
            Send all pages from one crawl to the same Figma file
          </label>
        </>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={save}>{saved ? "Saved" : "Save"}</button>
      </div>
    </div>
  );
}
