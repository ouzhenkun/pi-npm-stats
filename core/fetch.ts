import type { PackageStats, QueryOptions, SortKey } from "../types";
import {
  getCachedDownloads,
  loadCache,
  saveCache,
  setCachedDownloads,
} from "./cache";

const SEARCH = "https://registry.npmjs.org/-/v1/search";
const DOWNLOADS = "https://api.npmjs.org/downloads";
const UA = "pi-npm-stats/0.1.0";
const CONCURRENCY = 2;
/** Max retry attempts after the first failure (total tries = 1 + MAX_RETRIES). */
const MAX_RETRIES = 3;

interface SearchPackage {
  name: string;
  description?: string;
  version?: string;
  date?: string;
  keywords?: string[];
}

interface SearchObject {
  package: SearchPackage;
  searchScore?: number;
  score?: { final?: number };
}

export interface FetchProgress {
  matched: PackageStats[];
  loaded: number;
  total: number;
  done: boolean;
  cacheHits: number;
}

export type ProgressHandler = (state: FetchProgress) => void;

class HttpError extends Error {
  status: number;
  retryAfterMs?: number;

  constructor(status: number, url: string, retryAfterMs?: number) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isDownloadSort(sort: SortKey): boolean {
  return sort === "day" || sort === "week" || sort === "month";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.min(60_000, Math.max(0, date - Date.now()));
  return undefined;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let attempt = 0;
  while (true) {
    attempt++;
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal,
    });

    if (res.ok) return (await res.json()) as T;

    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt > MAX_RETRIES) {
      throw new HttpError(res.status, url, retryAfterMs);
    }

    const backoff = retryAfterMs ?? Math.min(8000, 1000 * 2 ** (attempt - 1));
    await sleep(backoff, signal);
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      if (signal?.aborted) throw new Error("aborted");
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }

  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function toBase(obj: SearchObject): PackageStats {
  const pkg = obj.package;
  const keywords = pkg.keywords ?? [];
  const searchScore = obj.searchScore ?? obj.score?.final ?? 0;
  return {
    name: pkg.name,
    description: pkg.description ?? "",
    version: pkg.version ?? "",
    day: 0,
    week: 0,
    month: 0,
    daily: [],
    searchScore,
    published: pkg.date ?? null,
    keywords,
    downloadsReady: false,
  };
}

function cmpVersion(a: string, b: string): number {
  const sa = a.replace(/^v/i, "").split(/[^0-9A-Za-z]+/).filter(Boolean);
  const sb = b.replace(/^v/i, "").split(/[^0-9A-Za-z]+/).filter(Boolean);
  const n = Math.max(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    const xa = sa[i] ?? "";
    const xb = sb[i] ?? "";
    const na = Number(xa);
    const nb = Number(xb);
    const aNum = Number.isFinite(na) && String(na) === xa;
    const bNum = Number.isFinite(nb) && String(nb) === xb;
    if (aNum && bNum) {
      if (na !== nb) return na - nb;
      continue;
    }
    const c = xa.localeCompare(xb);
    if (c) return c;
  }
  return 0;
}

export function sortRows(rows: PackageStats[], sort: SortKey): PackageStats[] {
  const out = [...rows];
  out.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "ver") {
      return cmpVersion(b.version || "", a.version || "") || a.name.localeCompare(b.name);
    }
    if (sort === "published") {
      const ta = a.published ? Date.parse(a.published) : 0;
      const tb = b.published ? Date.parse(b.published) : 0;
      return tb - ta || a.name.localeCompare(b.name);
    }
    if (sort === "score") {
      return b.searchScore - a.searchScore || a.name.localeCompare(b.name);
    }
    // day / week / month — ready first, errors last, then by value.
    if (a.downloadsReady !== b.downloadsReady) return a.downloadsReady ? -1 : 1;
    if (!!a.error !== !!b.error) return a.error ? 1 : -1;
    return (b[sort] ?? 0) - (a[sort] ?? 0) || a.name.localeCompare(b.name);
  });
  return out;
}

export function applyLimit(rows: PackageStats[], sort: SortKey, limit: number): PackageStats[] {
  return sortRows(rows, sort).slice(0, Math.max(1, limit));
}

async function fetchAuthorPackages(author: string, signal?: AbortSignal): Promise<SearchObject[]> {
  const out: SearchObject[] = [];
  const size = 250;
  let from = 0;

  while (true) {
    if (signal?.aborted) throw new Error("aborted");
    const url =
      `${SEARCH}?text=${encodeURIComponent(`author:${author}`)}` +
      `&size=${size}&from=${from}`;
    const data = await getJson<{ objects?: SearchObject[]; total?: number }>(url, signal);
    const batch = data.objects ?? [];
    out.push(...batch);
    if (batch.length < size) break;
    from += size;
    if (from >= (data.total ?? out.length)) break;
  }

  return out;
}

/** One range request → day/week/month + spark. */
async function fetchDownloads(
  name: string,
  signal?: AbortSignal,
): Promise<{ day: number; week: number; month: number; daily: number[] }> {
  const enc = encodeURIComponent(name);
  const range = await getJson<{ downloads?: Array<{ downloads: number; day?: string }> }>(
    `${DOWNLOADS}/range/last-month/${enc}`,
    signal,
  );
  const points = (range.downloads ?? []).map((d) => d.downloads ?? 0);
  const month = points.reduce((sum, n) => sum + n, 0);
  const weekPoints = points.slice(-7);
  const week = weekPoints.reduce((sum, n) => sum + n, 0);
  const day = points.length ? points[points.length - 1]! : 0;
  return {
    day,
    week,
    month,
    daily: weekPoints,
  };
}

function matchesPrefix(name: string, prefix: string): boolean {
  if (!prefix) return true;
  return name.startsWith(prefix);
}

function applyDownloads(
  live: PackageStats,
  dl: { day: number; week: number; month: number; daily: number[] },
  fromCache: boolean,
): void {
  live.day = dl.day;
  live.week = dl.week;
  live.month = dl.month;
  live.daily = dl.daily;
  live.downloadsReady = true;
  live.fromCache = fromCache;
  live.error = undefined;
}

/**
 * Progressive fetch with:
 * - single downloads range request per package
 * - 429/5xx retry + backoff
 * - disk cache (TTL) for downloads
 * - concurrency 2
 */
export async function fetchPackageStatsProgressive(
  query: QueryOptions,
  onProgress: ProgressHandler,
  signal?: AbortSignal,
): Promise<PackageStats[]> {
  const objects = await fetchAuthorPackages(query.author, signal);
  let matched = objects.map(toBase).filter((p) => matchesPrefix(p.name, query.prefix));

  // Metadata sorts can cap before download fetches; download sorts need full set.
  const preLimit = !isDownloadSort(query.sort);
  let fetchTargets = matched;
  if (preLimit) {
    fetchTargets = applyLimit(matched, query.sort, query.limit);
  }

  const byName = new Map(matched.map((p) => [p.name, p]));
  for (const p of fetchTargets) byName.set(p.name, p);
  matched = [...byName.values()];

  const cache = loadCache();
  let loaded = 0;
  let cacheHits = 0;
  const total = fetchTargets.length;
  let cacheDirty = false;

  const persistCache = () => {
    if (!cacheDirty) return;
    try {
      saveCache(cache);
      cacheDirty = false;
    } catch {
      // ignore disk errors; network path still works
    }
  };

  if (!query.force) {
    for (const row of fetchTargets) {
      const hit = getCachedDownloads(cache, row.name, query.cacheTtlHours);
      if (!hit) continue;
      const live = byName.get(row.name);
      if (!live) continue;
      applyDownloads(live, hit, true);
      loaded++;
      cacheHits++;
    }
  }

  onProgress({
    matched: matched.map(cloneRow),
    loaded,
    total,
    done: false,
    cacheHits,
  });

  const needFetch = fetchTargets.filter((row) => {
    const live = byName.get(row.name);
    return !live?.downloadsReady;
  });

  try {
    await mapPool(
      needFetch,
      CONCURRENCY,
      async (row) => {
        try {
          const dl = await fetchDownloads(row.name, signal);
          const live = byName.get(row.name);
          if (!live) return row;
          applyDownloads(live, dl, false);
          setCachedDownloads(cache, row.name, dl);
          cacheDirty = true;
          loaded++;
          // Flush occasionally so abort does not lose all progress.
          if (loaded % 5 === 0) persistCache();
          onProgress({
            matched: matched.map(cloneRow),
            loaded,
            total,
            done: false,
            cacheHits,
          });
          return live;
        } catch (err) {
          if (signal?.aborted) throw err;
          const live = byName.get(row.name);
          if (!live) return row;
          // Keep ready=false so failed rows sink in download sorts and can retry.
          live.downloadsReady = false;
          live.fromCache = false;
          live.day = 0;
          live.week = 0;
          live.month = 0;
          live.daily = [];
          // downloads 404 = no stats yet (e.g. newly published). Treat as empty
          // state, not an error; network/5xx/429 still surface as warnings.
          if (!(err instanceof HttpError && err.status === 404)) {
            live.error = err instanceof Error ? err.message : String(err);
          } else {
            live.error = undefined;
          }
          loaded++;
          onProgress({
            matched: matched.map(cloneRow),
            loaded,
            total,
            done: false,
            cacheHits,
          });
          return live;
        }
      },
      signal,
    );
  } finally {
    persistCache();
  }

  matched = [...byName.values()];
  onProgress({
    matched: matched.map(cloneRow),
    loaded,
    total,
    done: true,
    cacheHits,
  });
  return matched;
}

function cloneRow(p: PackageStats): PackageStats {
  return { ...p, daily: [...(p.daily ?? [])], keywords: [...(p.keywords ?? [])] };
}

export async function fetchPackageStats(query: QueryOptions): Promise<PackageStats[]> {
  return fetchPackageStatsProgressive(query, () => {});
}
