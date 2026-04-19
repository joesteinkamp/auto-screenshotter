import { useEffect, useState } from "react";
import type { CrawlOptions, ExtensionSettings, ScrollBehavior } from "../types";
import { ChevronRightIcon } from "./Icons";

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
          className={`disclosure ${showAdvanced ? "open" : ""}`}
          onClick={() => setShowAdvanced(!showAdvanced)}
          aria-expanded={showAdvanced}
        >
          <ChevronRightIcon className="chev" />
          Advanced options
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
              <label>Scroll behavior</label>
              <div className="segmented" role="group" aria-label="Scroll behavior">
                {[
                  { value: "combine", label: "Combine" },
                  { value: "separate", label: "Separate" },
                  { value: "none", label: "None" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={disabled}
                    className={scrollBehavior === opt.value ? "on" : ""}
                    aria-pressed={scrollBehavior === opt.value}
                    onClick={() => setScrollBehavior(opt.value as ScrollBehavior)}
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
