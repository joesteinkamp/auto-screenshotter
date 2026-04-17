import { useEffect, useMemo, useState } from "react";
import type { JobSummary } from "../types";
import { getJobScreenshots } from "../lib/storage";

interface Props {
  jobs: JobSummary[];
  activeJobId: string | null;
  onSelectJob: (jobId: string) => void;
}

interface ScreenshotEntry {
  key: string;
  url: string;
  pageUrl: string;
  label: string;
}

/**
 * Parse a key of the form `${jobId}:${order}-${normalizedUrl}[-tileN|-stateN]`
 * into something we can group & label by.
 */
function parseKey(key: string): { pageUrl: string; label: string } {
  const colon = key.indexOf(":");
  const rest = colon >= 0 ? key.slice(colon + 1) : key;
  const dash = rest.indexOf("-");
  const remainder = dash >= 0 ? rest.slice(dash + 1) : rest;

  const tileMatch = remainder.match(/-tile(\d+)$/);
  const stateMatch = remainder.match(/-state(\d+)$/);

  let pageUrl = remainder;
  let label = "full";
  if (tileMatch) {
    pageUrl = remainder.slice(0, -tileMatch[0].length);
    label = `tile ${tileMatch[1]}`;
  } else if (stateMatch) {
    pageUrl = remainder.slice(0, -stateMatch[0].length);
    label = `state ${stateMatch[1]}`;
  }
  return { pageUrl, label };
}

export default function GalleryTab({ jobs, activeJobId, onSelectJob }: Props) {
  const [entries, setEntries] = useState<ScreenshotEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalUrl, setModalUrl] = useState<string | null>(null);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === activeJobId) ?? jobs[0],
    [jobs, activeJobId],
  );

  useEffect(() => {
    if (!selectedJob) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    const urls: string[] = [];
    setLoading(true);
    getJobScreenshots(selectedJob.id)
      .then((rows) => {
        if (cancelled) {
          rows.forEach((r) => URL.revokeObjectURL(URL.createObjectURL(r.blob)));
          return;
        }
        const mapped: ScreenshotEntry[] = rows.map((r) => {
          const { pageUrl, label } = parseKey(r.key);
          const objectUrl = URL.createObjectURL(r.blob);
          urls.push(objectUrl);
          return { key: r.key, url: objectUrl, pageUrl, label };
        });
        setEntries(mapped);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [selectedJob?.id]);

  const groups = useMemo(() => {
    const map = new Map<string, ScreenshotEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.pageUrl) ?? [];
      arr.push(e);
      map.set(e.pageUrl, arr);
    }
    return [...map.entries()];
  }, [entries]);

  if (jobs.length === 0) {
    return (
      <div className="section empty-state">
        No captures yet. Start one from the <strong>Capture</strong> tab or via MCP.
      </div>
    );
  }

  return (
    <div className="section">
      <label htmlFor="job-select">Job</label>
      <select
        id="job-select"
        value={selectedJob?.id ?? ""}
        onChange={(e) => onSelectJob(e.target.value)}
      >
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.id} · {j.kind} · {j.status.state} · {j.pageCount} pages
          </option>
        ))}
      </select>

      {selectedJob?.zipFilename && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
          Zip: <code>{selectedJob.zipFilename}</code>
        </div>
      )}

      {loading && <div style={{ marginTop: 10, color: "var(--muted)" }}>Loading…</div>}

      {!loading && entries.length === 0 && (
        <div style={{ marginTop: 10, color: "var(--muted)" }}>No screenshots in this job.</div>
      )}

      {groups.map(([pageUrl, shots]) => (
        <div key={pageUrl} className="gallery-group">
          <div className="gallery-group-title" title={pageUrl}>{pageUrl}</div>
          <div className="gallery-thumbs">
            {shots.map((s) => (
              <button
                type="button"
                key={s.key}
                className="gallery-thumb"
                onClick={() => setModalUrl(s.url)}
                title={s.label}
              >
                <img src={s.url} alt={s.label} />
                <span className="gallery-thumb-label">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {modalUrl && (
        <div className="modal-backdrop" onClick={() => setModalUrl(null)}>
          <img src={modalUrl} alt="" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
