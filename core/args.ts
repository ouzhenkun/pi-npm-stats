import { SORTS } from "./config";
import type { NpmStatsConfig, QueryOptions, SortKey } from "../types";

export interface ParseArgsResult {
  query: QueryOptions;
  warnings: string[];
}

function takeValue(
  tokens: string[],
  i: number,
  inline?: string,
): { value: string; next: number } | null {
  if (inline !== undefined) return { value: inline, next: i };
  const next = tokens[i + 1];
  if (next === undefined || next.startsWith("-")) return null;
  return { value: next, next: i + 1 };
}

/** Strip surrounding quotes so --prefix "" / --author "x" work from slash-args. */
function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseArgs(input: string, cfg: NpmStatsConfig): ParseArgsResult {
  const warnings: string[] = [];
  const tokens = input.trim() ? input.trim().split(/\s+/) : [];

  let author = cfg.author;
  let sort = cfg.sort;
  let limit = cfg.limit;
  let prefix = cfg.prefix.trim();
  let force = false;
  let authorSet = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;

    if (tok === "--author" || tok === "-u") {
      const got = takeValue(tokens, i);
      if (!got) {
        warnings.push(`${tok} needs an author name`);
        continue;
      }
      author = unquote(got.value);
      authorSet = true;
      i = got.next;
      continue;
    }

    if (tok.startsWith("--author=")) {
      author = unquote(tok.slice("--author=".length));
      authorSet = true;
      continue;
    }

    if (tok === "--prefix" || tok === "-p") {
      const got = takeValue(tokens, i);
      if (!got) {
        warnings.push(`${tok} needs a value (use --prefix "" to clear)`);
        continue;
      }
      prefix = unquote(got.value).trim();
      i = got.next;
      continue;
    }

    if (tok.startsWith("--prefix=")) {
      prefix = unquote(tok.slice("--prefix=".length)).trim();
      continue;
    }

    if (tok === "--limit" || tok === "-n") {
      const got = takeValue(tokens, i);
      if (!got) {
        warnings.push(`${tok} needs a number`);
        continue;
      }
      const n = Number(got.value);
      if (!Number.isFinite(n) || n < 1) {
        warnings.push(`invalid limit "${got.value}"`);
      } else {
        limit = Math.max(1, Math.min(500, Math.floor(n)));
      }
      i = got.next;
      continue;
    }

    if (tok.startsWith("--limit=")) {
      const n = Number(tok.slice("--limit=".length));
      if (!Number.isFinite(n) || n < 1) warnings.push(`invalid limit in ${tok}`);
      else limit = Math.max(1, Math.min(500, Math.floor(n)));
      continue;
    }

    if (tok === "--sort" || tok === "-s") {
      const got = takeValue(tokens, i);
      if (!got) {
        warnings.push(`${tok} needs one of name|ver|day|week|month|score|published`);
        continue;
      }
      if (!SORTS.has(got.value as SortKey)) {
        warnings.push(`invalid sort "${got.value}"`);
      } else {
        sort = got.value as SortKey;
      }
      i = got.next;
      continue;
    }

    if (tok.startsWith("--sort=")) {
      const v = tok.slice("--sort=".length);
      if (!SORTS.has(v as SortKey)) warnings.push(`invalid sort "${v}"`);
      else sort = v as SortKey;
      continue;
    }

    if (tok === "--force" || tok === "-f") {
      force = true;
      continue;
    }

    if (tok.startsWith("-")) {
      warnings.push(`unknown flag ${tok}`);
      continue;
    }

    if (!authorSet) {
      author = unquote(tok);
      authorSet = true;
    } else {
      warnings.push(`unexpected arg "${tok}"`);
    }
  }

  return {
    query: {
      author: author.trim(),
      sort,
      limit,
      prefix,
      cacheTtlHours: cfg.cacheTtlHours,
      force,
    },
    warnings,
  };
}
