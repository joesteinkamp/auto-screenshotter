import { useEffect, useState } from "react";
import type { CrawlOptions, ExtensionSettings } from "../types";

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

  useEffect(() => {
    if (defaults) {
      setMaxPages(defaults.defaultMaxPages);
      setMaxDepth(defaults.defaultMaxDepth);
      setRequestDelay(defaults.defaultRequestDelayMs);
    }
  }, [defaults]);

  useEffect(() => {
    // Prefill with the active tab's URL as a convenience
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const activeUrl = tabs[0]?.url;
      if (activeUrl && /^https?:\/\//.test(activeUrl)) setUrl(activeUrl);
    });
  }, []);

  const llmAvailable = !!defaults?.anthropicApiKey;

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
    });
  };

  return (
    <form onSubmit={handleSubmit} className="section">
      <label htmlFor="start-url">Start URL</label>
      <input
        id="start-url"
        type="url"
        required
        placeholder="https://example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={disabled}
      />

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

      <div className="checkbox-row" title={llmAvailable ? "" : "Add an Anthropic API key in Settings to enable"}>
        <input
          id="use-llm"
          type="checkbox"
          checked={useLlm && llmAvailable}
          onChange={(e) => setUseLlm(e.target.checked)}
          disabled={disabled || !llmAvailable}
        />
        <label htmlFor="use-llm">
          Use Claude to rank pages {!llmAvailable && <em>(needs API key)</em>}
        </label>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button type="submit" className="primary" disabled={disabled || !url}>
          Start Crawl
        </button>
      </div>
    </form>
  );
}
