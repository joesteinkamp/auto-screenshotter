/**
 * IndexedDB wrapper for screenshot blobs, plus chrome.storage.local
 * for persistent settings.
 */

import { openDB, type IDBPDatabase } from "idb";
import type { AiProvider, ExtensionSettings, ProviderSettings } from "../types";

const DB_NAME = "auto-screenshotter";
const DB_VERSION = 1;
const SHOTS_STORE = "screenshots";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(SHOTS_STORE)) {
          db.createObjectStore(SHOTS_STORE);
        }
      },
    });
  }
  return dbPromise;
}

export async function putScreenshot(key: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put(SHOTS_STORE, blob, key);
}

export async function getScreenshot(key: string): Promise<Blob | undefined> {
  const db = await getDb();
  return db.get(SHOTS_STORE, key);
}

export async function getAllScreenshots(): Promise<Array<{ key: string; blob: Blob }>> {
  const db = await getDb();
  const keys = (await db.getAllKeys(SHOTS_STORE)) as string[];
  const blobs = (await db.getAll(SHOTS_STORE)) as Blob[];
  return keys.map((key, i) => ({ key, blob: blobs[i] }));
}

export async function clearScreenshots(): Promise<void> {
  const db = await getDb();
  await db.clear(SHOTS_STORE);
}

// ---- Settings via chrome.storage.local ----

const SETTINGS_KEY = "settings";

const EMPTY_PROVIDER: ProviderSettings = { apiKey: "", model: "" };

const DEFAULT_SETTINGS: ExtensionSettings = {
  aiProvider: "anthropic",
  providers: {
    anthropic: { ...EMPTY_PROVIDER },
    openai: { ...EMPTY_PROVIDER },
    gemini: { ...EMPTY_PROVIDER },
  },
  defaultMaxPages: 50,
  defaultMaxDepth: 4,
  defaultRequestDelayMs: 1000,
};

/**
 * Merge persisted settings with defaults and migrate the legacy
 * `anthropicApiKey` field into the new provider map if present.
 */
function normalizeSettings(raw: Partial<ExtensionSettings> | undefined): ExtensionSettings {
  const merged: ExtensionSettings = {
    ...DEFAULT_SETTINGS,
    ...(raw ?? {}),
    providers: {
      anthropic: { ...DEFAULT_SETTINGS.providers.anthropic, ...(raw?.providers?.anthropic ?? {}) },
      openai: { ...DEFAULT_SETTINGS.providers.openai, ...(raw?.providers?.openai ?? {}) },
      gemini: { ...DEFAULT_SETTINGS.providers.gemini, ...(raw?.providers?.gemini ?? {}) },
    },
  };

  // Legacy migration: if an old install had `anthropicApiKey` at the root
  // and the new nested field is empty, copy it across.
  if (raw?.anthropicApiKey && !merged.providers.anthropic.apiKey) {
    merged.providers.anthropic.apiKey = raw.anthropicApiKey;
  }
  delete merged.anthropicApiKey;

  return merged;
}

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(result[SETTINGS_KEY]);
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
  const current = await getSettings();
  const next: ExtensionSettings = {
    ...current,
    ...settings,
    providers: {
      ...current.providers,
      ...(settings.providers ?? {}),
    },
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
}

/** Convenience: get the API key for a specific provider. */
export function getProviderApiKey(settings: ExtensionSettings, provider: AiProvider): string {
  return settings.providers[provider]?.apiKey ?? "";
}
