import { useEffect, useState } from "react";
import type { CrawlOptions, ExtensionSettings, ScrollBehavior } from "../types";

interface Props {
  defaults: ExtensionSettings | null;
  disabled: boolean;
  onStart: (options: CrawlOptions) => void;
}

export default function CrawlForm({ defaults, disabled, onStart }: Props) {
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(50);
  const [maxDepth, setMaxDepth] = useState(4);
  const [sameOrigin, setSameOrigin] = useState(true);
  const [useLlm, setUseLlm] = useState(false);
  const [requestDelay, setRequestDelay] = useState(1000);
  const [scrollBehavior, setScrollBehavior] = useState<ScrollBehavior>("combine");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (defaults) {
      setMaxPages(defaults.defaultMaxPages);
      setMaxDepth(defaults.defaultMaxDepth);
      setRequestDelay(defaults.defaultRequestDelayMs);
      setScrollBehavior(defaults.defaultScrollBehavior);
    }
  }, [defaults]);

  useEffect(() => {
    // Prefill with the active tab's URL as a convenience. Use lastFocusedWindow
    // so the side panel finds the user's browsing tab, not the panel itself.
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
      const activeUrl = tabs[0]?.url;
      if (activeUrl && /^https?:\/\//.test(activeUrl)) setUrl(activeUrl);
    });
  }, []);

  const selectedProvider = defaults?.aiProvider;
  const llmAvailable = !!(
    selectedProvider && defaults?.providers?.[selectedProvider]?.apiKey
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    onStart({
      startUrl: url,
      maxPages,
      maxDepth,
      sameOriginOnly: sameOrigin,
      useLlm: useLlm && llmAvailable,
      requestDelayMs: requestDelay,
      scrollBehavior,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="section">
      <div>
        <label htmlFor="start-url">Start URL</label>
        <input
          id="start-url"
          type="url"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={disabled}
          required
        />
      </div>

      <div className="options">
        <div>
          <label htmlFor="max-pages">Max pages</label>
          <input
            id="max-pages"
            type="number"
            min={1}
            max={500}
            value={maxPages}
            onChange={(e) => setMaxPages(Number(e.target.value))}
            disabled={disabled}
          />
        </div>
        <div>
          <label htmlFor="max-depth">Max depth</label>
          <input
            id="max-depth"
            type="number"
            min={1}
            max={10}
            value={maxDepth}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
            disabled={disabled}
          />
        </div>
      </div>

      <div style={{ margin: "16px 0 8px" }}>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <svg
            style={{
              width: 14,
              height: 14,
              transform: showAdvanced ? "rotate(90deg)" : "rotate(0)",
              transition: "transform 0.15s ease",
            }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Advanced Options
        </button>
      </div>

      {showAdvanced && (
        <div style={{ paddingLeft: "4px", marginBottom: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "10px", marginBottom: "12px", alignItems: "start" }}>
            <div>
              <label htmlFor="delay">Delay (ms)</label>
              <input
                id="delay"
                type="number"
                min={0}
                max={60000}
                step={100}
                value={requestDelay}
                onChange={(e) => setRequestDelay(Number(e.target.value))}
                disabled={disabled}
              />
            </div>
            <div>
              <label>Scroll Behavior</label>
              <div
                style={{
                  display: "flex",
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: "5px",
                  overflow: "hidden",
                  height: "31px",
                }}
              >
                {[
                  { value: "combine", label: "Combine" },
                  { value: "separate", label: "Separate" },
                  { value: "none", label: "Don't Scroll" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => setScrollBehavior(opt.value as ScrollBehavior)}
                    style={{
                      flex: 1,
                      border: "none",
                      background: scrollBehavior === opt.value ? "var(--accent)" : "transparent",
                      color: scrollBehavior === opt.value ? "#fff" : "var(--text)",
                      padding: "0 2px",
                      fontSize: "10px",
                      borderRadius: 0,
                      cursor: "pointer",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="checkbox-row">
            <input
              id="same-origin"
              type="checkbox"
              checked={sameOrigin}
              onChange={(e) => setSameOrigin(e.target.checked)}
              disabled={disabled}
            />
            <label htmlFor="same-origin">Same origin only</label>
          </div>

          <div
            className="checkbox-row"
            title={llmAvailable ? "" : "Add an API key for your chosen provider in Settings to enable"}
          >
            <input
              id="use-llm"
              type="checkbox"
              checked={useLlm && llmAvailable}
              onChange={(e) => setUseLlm(e.target.checked)}
              disabled={disabled || !llmAvailable}
            />
            <label htmlFor="use-llm">
              Capture menus & dynamic page states {!llmAvailable && <em>(needs AI key)</em>}
            </label>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button type="submit" className="primary" disabled={disabled || !url}>
          Start Crawl
        </button>
      </div>
    </form>
  );
}
