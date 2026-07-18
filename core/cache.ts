import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CachedDownloads } from "../types";
import { agentDir } from "./config";

interface CacheFile {
  version: 1;
  packages: Record<string, CachedDownloads>;
}

export function cachePath(): string {
  return join(agentDir(), "pi-npm-stats-cache.json");
}

function emptyCache(): CacheFile {
  return { version: 1, packages: {} };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeEntry(raw: unknown): CachedDownloads | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  if (!isFiniteNumber(e.day) || !isFiniteNumber(e.week) || !isFiniteNumber(e.month)) return null;
  if (!isFiniteNumber(e.fetchedAt)) return null;
  if (!Array.isArray(e.daily)) return null;
  const daily = e.daily.map((n) => (isFiniteNumber(n) ? n : 0));
  return {
    day: e.day,
    week: e.week,
    month: e.month,
    daily,
    fetchedAt: e.fetchedAt,
  };
}

export function loadCache(): CacheFile {
  const path = cachePath();
  if (!existsSync(path)) return emptyCache();
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<CacheFile>;
    if (!raw || typeof raw !== "object" || !raw.packages || typeof raw.packages !== "object") {
      return emptyCache();
    }
    const packages: Record<string, CachedDownloads> = {};
    for (const [name, entry] of Object.entries(raw.packages)) {
      const clean = sanitizeEntry(entry);
      if (clean) packages[name] = clean;
    }
    return { version: 1, packages };
  } catch {
    return emptyCache();
  }
}

export function saveCache(cache: CacheFile): void {
  const path = cachePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache), "utf-8");
}

export function getCachedDownloads(
  cache: CacheFile,
  name: string,
  ttlHours: number,
  now = Date.now(),
): CachedDownloads | null {
  if (ttlHours <= 0) return null;
  const entry = cache.packages[name];
  if (!entry) return null;
  const ttlMs = ttlHours * 60 * 60 * 1000;
  if (now - entry.fetchedAt > ttlMs) return null;
  return entry;
}

export function setCachedDownloads(
  cache: CacheFile,
  name: string,
  data: Omit<CachedDownloads, "fetchedAt">,
  now = Date.now(),
): void {
  cache.packages[name] = {
    day: data.day,
    week: data.week,
    month: data.month,
    daily: [...data.daily],
    fetchedAt: now,
  };
}
