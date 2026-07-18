import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { NpmStatsConfig, QueryOptions, SortKey } from "../types";

export const SORTS = new Set<SortKey>([
  "name",
  "ver",
  "day",
  "week",
  "month",
  "score",
  "published",
]);

export function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function configPath(): string {
  return join(agentDir(), "pi-npm-stats.json");
}

export const DEFAULTS: NpmStatsConfig = {
  author: "",
  sort: "month",
  limit: 20,
  prefix: "",
  cacheTtlHours: 6,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseLimit(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(500, Math.floor(value)));
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return Math.max(1, Math.min(500, Math.floor(n)));
  }
  return fallback;
}

function parseTtlHours(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(168, value));
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return Math.max(0, Math.min(168, n));
  }
  return fallback;
}

export function loadConfig(): NpmStatsConfig {
  const path = configPath();
  if (!existsSync(path)) return { ...DEFAULTS };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    console.warn(`[pi-npm-stats] failed to parse ${path}`);
    return { ...DEFAULTS };
  }

  if (!isObject(raw)) return { ...DEFAULTS };

  const author = typeof raw.author === "string" ? raw.author.trim() : DEFAULTS.author;
  const sort =
    typeof raw.sort === "string" && SORTS.has(raw.sort as SortKey)
      ? (raw.sort as SortKey)
      : DEFAULTS.sort;
  const limit = parseLimit(raw.limit, DEFAULTS.limit);
  const prefix = typeof raw.prefix === "string" ? raw.prefix.trim() : DEFAULTS.prefix;
  const cacheTtlHours = parseTtlHours(raw.cacheTtlHours, DEFAULTS.cacheTtlHours);

  return { author, sort, limit, prefix, cacheTtlHours };
}

/** Persist query prefs (not force). Creates the file if missing. */
export function saveConfig(cfg: NpmStatsConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const body: NpmStatsConfig = {
    author: cfg.author,
    sort: cfg.sort,
    limit: cfg.limit,
    prefix: cfg.prefix,
    cacheTtlHours: cfg.cacheTtlHours,
  };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, "utf-8");
}

export function saveQueryPrefs(query: QueryOptions): void {
  saveConfig({
    author: query.author,
    sort: query.sort,
    limit: query.limit,
    prefix: query.prefix,
    cacheTtlHours: query.cacheTtlHours,
  });
}
