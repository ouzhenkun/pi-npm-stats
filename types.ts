export type SortKey =
  | "name"
  | "ver"
  | "day"
  | "week"
  | "month"
  | "score"
  | "published";

export interface NpmStatsConfig {
  author: string;
  sort: SortKey;
  limit: number;
  /** Package name prefix filter. Empty string = no filter. */
  prefix: string;
  /** Download stats cache TTL in hours. */
  cacheTtlHours: number;
}

export interface QueryOptions {
  author: string;
  sort: SortKey;
  limit: number;
  prefix: string;
  cacheTtlHours: number;
  /** Bypass download cache. */
  force: boolean;
}

export interface PackageStats {
  name: string;
  description: string;
  version: string;
  day: number;
  week: number;
  month: number;
  daily: number[];
  searchScore: number;
  published: string | null;
  keywords: string[];
  downloadsReady: boolean;
  /** true when values came from local cache. */
  fromCache?: boolean;
  error?: string;
}

export interface CachedDownloads {
  day: number;
  week: number;
  month: number;
  daily: number[];
  fetchedAt: number;
}
