/**
 * Tracks MCP-triggered and panel-triggered jobs. Lives in the service worker.
 *
 * Persists a snapshot to chrome.storage.local so the panel still shows prior
 * jobs after the SW is killed. Screenshot blobs themselves live in IndexedDB
 * (see `storage.ts`) and outlive SW restarts naturally.
 */

import type { CrawlStatus, Job, JobKind, JobSummary } from "../types";
import { broadcastToPanel } from "../lib/messaging";
import { purgeOldJobs } from "../lib/storage";

const STORAGE_KEY = "jobs";
const LRU_KEEP = 5;

type StateChangeResolver = (job: Job) => void;

const jobs = new Map<string, Job>();
const waiters = new Map<string, Set<StateChangeResolver>>();
let rehydrated = false;

function now(): number {
  return Date.now();
}

function mintJobId(): string {
  // 8 hex chars — enough for localhost single-user scope.
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

function summarize(job: Job): JobSummary {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    pageCount: job.pageCount,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    zipFilename: job.zipFilename,
  };
}

async function persist(): Promise<void> {
  const snapshot = Array.from(jobs.values());
  await chrome.storage.local.set({ [STORAGE_KEY]: snapshot });
}

export async function ensureRehydrated(): Promise<void> {
  if (rehydrated) return;
  rehydrated = true;
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const list = (raw[STORAGE_KEY] as Job[] | undefined) ?? [];
  for (const job of list) {
    // Any job that was running when the SW died is orphaned.
    if (job.status.state === "running") {
      job.status = {
        state: "error",
        message: "service worker restarted",
        capturedCount: job.pageCount,
      };
      job.errorMessage = "service worker restarted";
      job.finishedAt = job.finishedAt ?? now();
      job.updatedAt = now();
    }
    jobs.set(job.id, job);
  }
  broadcastJobs();
}

export function createJob(kind: JobKind): Job {
  const id = mintJobId();
  const job: Job = {
    id,
    kind,
    createdAt: now(),
    updatedAt: now(),
    pageCount: 0,
    status: { state: "running", currentUrl: "", capturedCount: 0, queueSize: 0 },
  };
  jobs.set(id, job);
  persist();
  broadcastJobs();
  return job;
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function getLatestJob(): Job | undefined {
  let latest: Job | undefined;
  for (const j of jobs.values()) {
    if (!latest || j.createdAt > latest.createdAt) latest = j;
  }
  return latest;
}

export function listJobs(): JobSummary[] {
  return Array.from(jobs.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(summarize);
}

export function updateJob(
  jobId: string,
  patch: Partial<Pick<Job, "status" | "pageCount" | "totalCount" | "currentUrl" | "zipFilename" | "errorMessage" | "finishedAt">>,
): Job | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  Object.assign(job, patch);
  job.updatedAt = now();
  persist();
  broadcastJobs();
  notifyWaiters(job);
  return job;
}

export function finishJob(
  jobId: string,
  status: CrawlStatus,
  zipFilename?: string,
  errorMessage?: string,
): Job | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  job.status = status;
  job.finishedAt = now();
  job.updatedAt = now();
  if (zipFilename) job.zipFilename = zipFilename;
  if (errorMessage) job.errorMessage = errorMessage;
  persist();
  broadcastJobs();
  notifyWaiters(job);
  // LRU: keep only most-recent N jobs and their screenshots.
  const kept = listJobs().slice(0, LRU_KEEP).map((s) => s.id);
  const dropped: string[] = [];
  for (const id of jobs.keys()) {
    if (!kept.includes(id)) dropped.push(id);
  }
  for (const id of dropped) jobs.delete(id);
  if (dropped.length > 0) {
    persist();
    purgeOldJobs(kept).catch(() => undefined);
  }
  return job;
}

function notifyWaiters(job: Job): void {
  const set = waiters.get(job.id);
  if (!set) return;
  for (const resolve of set) resolve(job);
  set.clear();
}

/**
 * Resolve when the job's state changes (any updateJob / finishJob call) or
 * when the timeout elapses. Returns the current job snapshot either way.
 */
export async function waitForStatusChange(
  jobId: string,
  sinceTs: number,
  timeoutMs: number,
): Promise<Job | undefined> {
  const current = jobs.get(jobId);
  if (!current) return undefined;
  if (current.updatedAt > sinceTs) return current;
  return new Promise<Job | undefined>((resolve) => {
    let set = waiters.get(jobId);
    if (!set) {
      set = new Set();
      waiters.set(jobId, set);
    }
    const timer = setTimeout(() => {
      set!.delete(resolver);
      resolve(jobs.get(jobId));
    }, timeoutMs);
    const resolver: StateChangeResolver = (job) => {
      clearTimeout(timer);
      resolve(job);
    };
    set.add(resolver);
  });
}

function broadcastJobs(): void {
  broadcastToPanel({ type: "jobs/update", jobs: listJobs() });
}
