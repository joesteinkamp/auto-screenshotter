import { useEffect, useState } from "react";
import type {
  CrawlOptions,
  CrawlState,
  ExtensionSettings,
  JobSummary,
  MCPConnectionInfo,
} from "../types";
import { onPanelEvent, sendToBackground } from "../lib/messaging";
import { getSettings } from "../lib/storage";
import CaptureTab from "./CaptureTab";
import GalleryTab from "./GalleryTab";
import McpTab from "./McpTab";
import SettingsPanel from "./SettingsPanel";
import { ArrowLeftIcon, GearIcon } from "./Icons";

type Tab = "capture" | "gallery" | "mcp";
type View = "main" | "settings";

export default function App() {
  const [state, setState] = useState<CrawlState | null>(null);
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [tab, setTab] = useState<Tab>("capture");
  const [view, setView] = useState<View>("main");
  const [mcp, setMcp] = useState<MCPConnectionInfo | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => {
    sendToBackground({ type: "crawl/getState" }).then((resp) => {
      if (resp.ok && resp.state) setState(resp.state);
    });
    sendToBackground({ type: "mcp/getStatus" }).then((resp) => {
      if (resp.ok && resp.mcp) setMcp(resp.mcp);
    });
    sendToBackground({ type: "jobs/list" }).then((resp) => {
      if (resp.ok && resp.jobs) setJobs(resp.jobs);
    });
    getSettings().then(setSettings);

    const unsubscribe = onPanelEvent((event) => {
      if (event.type === "state/update") setState(event.state);
      else if (event.type === "mcp/status") setMcp(event.info);
      else if (event.type === "jobs/update") setJobs(event.jobs);
    });
    return unsubscribe;
  }, []);

  const handleStart = async (options: CrawlOptions) => {
    const resp = await sendToBackground({ type: "crawl/start", options });
    if (resp.ok && resp.state) setState(resp.state);
    else if (!resp.ok) alert(resp.error);
  };

  const handleCaptureCurrent = async () => {
    const behavior = settings?.defaultScrollBehavior ?? "combine";
    const resp = await sendToBackground({
      type: "crawl/captureCurrent",
      scrollBehavior: behavior,
    });
    if (resp.ok && resp.state) setState(resp.state);
    else if (!resp.ok) alert(resp.error);
  };

  const handleCancel = async () => {
    const resp = await sendToBackground({ type: "crawl/cancel" });
    if (resp.ok && resp.state) setState(resp.state);
  };

  const handleDownload = async () => {
    const resp = await sendToBackground({ type: "crawl/download" });
    if (!resp.ok) alert(resp.error);
  };

  const handleMcpToggle = async (enabled: boolean) => {
    const resp = await sendToBackground({ type: "mcp/setEnabled", enabled });
    if (resp.ok && resp.mcp) setMcp(resp.mcp);
  };

  const handleRelayOverride = async (url: string) => {
    const resp = await sendToBackground({ type: "mcp/setRelayOverride", url });
    if (resp.ok && resp.mcp) setMcp(resp.mcp);
  };

  return (
    <div>
      <header>
        <h1>Auto Screenshotter</h1>
        <button
          className="icon-button"
          onClick={() => setView(view === "main" ? "settings" : "main")}
          title="Settings"
        >
          <GearIcon />
        </button>
      </header>

      {view === "settings" ? (
        <div className="settings-view">
          <div className="back-row" onClick={() => setView("main")}>
            <ArrowLeftIcon />
            <span>Back</span>
          </div>
          {settings && <SettingsPanel settings={settings} onChange={setSettings} />}
        </div>
      ) : (
        <>
          <nav className="tabs">
            <TabButton current={tab} me="capture" onSelect={setTab}>
              Capture
            </TabButton>
            <TabButton current={tab} me="gallery" onSelect={setTab}>
              Gallery
              {jobs.length > 0 && <span className="tab-badge">{jobs.length}</span>}
            </TabButton>
            <TabButton current={tab} me="mcp" onSelect={setTab}>
              MCP
              {mcp?.status === "connected" && <span className="tab-dot connected" />}
              {mcp?.status === "disconnected" && mcp?.enabled && <span className="tab-dot disconnected" />}
            </TabButton>
          </nav>

          {tab === "capture" && (
            <CaptureTab
              state={state}
              settings={settings}
              onStart={handleStart}
              onCaptureCurrent={handleCaptureCurrent}
              onCancel={handleCancel}
              onDownload={handleDownload}
            />
          )}

          {tab === "gallery" && (
            <GalleryTab
              jobs={jobs}
              activeJobId={selectedJobId ?? jobs[0]?.id ?? null}
              onSelectJob={setSelectedJobId}
            />
          )}

          {tab === "mcp" && (
            <McpTab
              info={mcp}
              onToggle={handleMcpToggle}
              onRelayOverride={handleRelayOverride}
            />
          )}
        </>
      )}
    </div>
  );
}

function TabButton({
  current,
  me,
  onSelect,
  children,
}: {
  current: Tab;
  me: Tab;
  onSelect: (tab: Tab) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`tab-btn ${current === me ? "active" : ""}`}
      onClick={() => onSelect(me)}
    >
      {children}
    </button>
  );
}
