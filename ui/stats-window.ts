import type { Theme } from "@earendil-works/pi-coding-agent";
import { applyLimit, isDownloadSort } from "../core/fetch";
import type { PackageStats, QueryOptions, SortKey } from "../types";
import {
  clip,
  formatDate,
  formatNum,
  formatScore,
  formatTime,
  isCloseKey,
  isDownKey,
  isEndKey,
  isHomeKey,
  isLeftKey,
  isPageDownKey,
  isPageUpKey,
  isRefreshKey,
  isRightKey,
  isSortNextKey,
  isUpKey,
  padL,
  padR,
  sparkline,
  truncateToWidth,
  visibleWidth,
} from "./format";

const SORT_CYCLE: SortKey[] = [
  "name",
  "ver",
  "day",
  "week",
  "month",
  "score",
  "published",
];
const PAGE_SIZE = 12;

export type ReloadOpts = { force?: boolean };

export class StatsWindow {
  private loadingList = true;
  private loadingDownloads = false;
  private matched: PackageStats[] = [];
  private loaded = 0;
  private loadTotal = 0;
  private cacheHits = 0;
  private message = "Fetching npm stats…";
  private refreshedAt: Date | null = null;
  private query: QueryOptions;
  private scroll = 0;

  constructor(
    private theme: Theme,
    private done: () => void,
    private requestRender: () => void,
    query: QueryOptions,
    private onReload: (opts?: ReloadOpts) => void,
    private unsubscribeInput?: () => void,
  ) {
    this.query = { ...query };
  }

  getQuery(): QueryOptions {
    return { ...this.query };
  }

  setLoading(query: QueryOptions, mode: "full" | "soft" = "full"): void {
    this.query = { ...query };
    if (mode === "full") {
      this.loadingList = true;
      this.loadingDownloads = false;
      this.matched = [];
      this.loaded = 0;
      this.loadTotal = 0;
      this.cacheHits = 0;
      this.scroll = 0;
      const label = query.force ? "force refresh" : "fetch";
      this.message = `${label} packages for author:${query.author}…`;
    } else {
      this.loadingList = false;
      this.loadingDownloads = true;
      this.message = `loading downloads for sort:${query.sort}…`;
    }
    this.requestRender();
  }

  /** Progress updates must not clobber user-changed sort. */
  setProgress(
    matched: PackageStats[],
    loaded: number,
    total: number,
    done: boolean,
    cacheHits = 0,
  ): void {
    this.matched = matched;
    this.loaded = loaded;
    this.loadTotal = total;
    this.cacheHits = cacheHits;
    this.loadingList = false;
    this.loadingDownloads = !done;
    this.refreshedAt = new Date();
    if (done) this.query = { ...this.query, force: false };
    if (matched.length === 0) {
      this.message =
        `No packages found for author:${this.query.author}` +
        (this.query.prefix ? ` prefix:${this.query.prefix}` : "");
    } else if (!done && this.message.startsWith("loading downloads")) {
      // keep soft-reload message while filling
    } else {
      this.message = "";
    }
    this.clampScroll();
    this.requestRender();
  }

  setError(error: string): void {
    this.loadingList = false;
    this.loadingDownloads = false;
    this.matched = [];
    this.message = error;
    this.requestRender();
  }

  handleInput(data: string): void {
    if (isCloseKey(data)) {
      this.done();
      return;
    }
    if (isRefreshKey(data)) {
      if (!this.loadingList && !this.loadingDownloads) this.onReload({ force: true });
      return;
    }
    if (isLeftKey(data) || isRightKey(data) || isSortNextKey(data)) {
      this.cycleSort(isLeftKey(data) ? -1 : 1);
      return;
    }

    const visible = this.visibleRows();
    if (isUpKey(data)) {
      this.scroll = Math.max(0, this.scroll - 1);
      this.requestRender();
      return;
    }
    if (isDownKey(data)) {
      this.scroll = Math.min(Math.max(0, visible.length - PAGE_SIZE), this.scroll + 1);
      this.requestRender();
      return;
    }
    if (isPageUpKey(data)) {
      this.scroll = Math.max(0, this.scroll - PAGE_SIZE);
      this.requestRender();
      return;
    }
    if (isPageDownKey(data)) {
      this.scroll = Math.min(Math.max(0, visible.length - PAGE_SIZE), this.scroll + PAGE_SIZE);
      this.requestRender();
      return;
    }
    if (isHomeKey(data)) {
      this.scroll = 0;
      this.requestRender();
      return;
    }
    if (isEndKey(data)) {
      this.scroll = Math.max(0, visible.length - PAGE_SIZE);
      this.requestRender();
    }
  }

  render(width: number): string[] {
    const w = Math.max(48, width);
    const innerW = Math.max(1, w - 2);
    const bodyW = Math.max(1, innerW - 2);
    const th = this.theme;

    const pad = (s: string) => s + " ".repeat(Math.max(0, bodyW - visibleWidth(s)));
    const row = (content = "") =>
      th.fg("border", "│") + " " + pad(truncateToWidth(content, bodyW)) + " " + th.fg("border", "│");

    const q = this.query;
    const visible = this.visibleRows();
    const totalShown = visible.length;
    const from = totalShown === 0 ? 0 : this.scroll + 1;
    const to = Math.min(totalShown, this.scroll + PAGE_SIZE);
    const prefixLabel = q.prefix === "" ? "(none)" : q.prefix;
    const cacheLabel = this.cacheHits > 0 ? ` cache ${this.cacheHits}` : "";
    const forceLabel = this.query.force ? " force" : "";
    const loadLabel = this.loadingList
      ? "listing…"
      : `loaded ${this.loaded}/${this.loadTotal}${cacheLabel}${forceLabel}` +
        (this.loadingDownloads ? " …" : "");

    const lines: string[] = [];
    lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
    lines.push(
      row(
        ` ${th.fg("accent", th.bold("npm stats"))}  ${th.fg("dim", `author:${q.author}`)}  ${th.fg("dim", `prefix:${prefixLabel}`)}  ${th.fg("dim", `sort:${q.sort}`)}  ${th.fg("dim", `top${q.limit}`)}`,
      ),
    );
    lines.push(
      row(
        ` ${th.fg("dim", `${from}-${to}/${totalShown}`)}  ${th.fg("dim", `matched ${this.matched.length}`)}  ${th.fg(this.loadingDownloads || this.loadingList ? "warning" : "dim", loadLabel)}`,
      ),
    );
    lines.push(row(th.fg("borderMuted", "─".repeat(bodyW))));

    if (this.message) {
      const color = this.loadingList || this.loadingDownloads
        ? "warning"
        : this.matched.length === 0
          ? "muted"
          : "warning";
      lines.push(row(` ${th.fg(color, this.message)}`));
    }

    if (totalShown > 0) {
      for (const line of this.renderTable(bodyW, visible)) {
        lines.push(row(line));
      }
    }

    lines.push(row());
    const refreshed = this.refreshedAt ? formatTime(this.refreshedAt) : "--:--:--";
    lines.push(
      row(
        ` ${th.fg("dim", `${refreshed} · ↑↓/jk · ←→ sort · space/b page · g/G · r force · Esc/q`)}`,
      ),
    );
    lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));
    return lines;
  }

  invalidate(): void {}

  dispose(): void {
    this.unsubscribeInput?.();
    this.unsubscribeInput = undefined;
  }

  private cycleSort(delta: number): void {
    if (this.loadingList) return;
    const i = Math.max(0, SORT_CYCLE.indexOf(this.query.sort));
    const next = SORT_CYCLE[(i + delta + SORT_CYCLE.length) % SORT_CYCLE.length]!;
    this.query = { ...this.query, sort: next };
    this.scroll = 0;

    // Switching to a download sort with incomplete coverage needs a soft reload.
    if (isDownloadSort(next) && this.matched.some((p) => !p.downloadsReady)) {
      this.onReload({ force: false });
      return;
    }
    this.requestRender();
  }

  private visibleRows(): PackageStats[] {
    return applyLimit(this.matched, this.query.sort, this.query.limit);
  }

  private clampScroll(): void {
    const n = this.visibleRows().length;
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, n - PAGE_SIZE)));
  }

  private renderTable(bodyW: number, visible: PackageStats[]): string[] {
    const th = this.theme;
    // Fixed cols: ver7 + day5 + week5 + month6 + score6 + date10 + spark7 + 8 spaces ≈ 54
    const nameW = Math.min(24, Math.max(12, bodyW - 54));
    const verW = 7;
    const dayW = 5;
    const weekW = 5;
    const monthW = 6;
    const scoreW = 6;
    const dateW = 10;
    const sparkW = 7;
    const sort = this.query.sort;

    const head = (label: string, w: number, align: "L" | "R", key?: SortKey) => {
      const text = align === "L" ? padL(label, w) : padR(label, w);
      if (key && key === sort) return th.fg("accent", th.bold(text));
      return th.fg("dim", text);
    };

    const cell = (text: string, key?: SortKey, tone?: "warning" | "accent") => {
      if (key && key === sort) return th.fg("accent", th.bold(text));
      if (tone === "warning") return th.fg("warning", text);
      if (tone === "accent") return th.fg("accent", text);
      return text;
    };

    const header =
      " " +
      head("package", nameW, "R", "name") +
      " " +
      head("ver", verW, "R", "ver") +
      " " +
      head("day", dayW, "L", "day") +
      " " +
      head("week", weekW, "L", "week") +
      " " +
      head("month", monthW, "L", "month") +
      " " +
      head("score", scoreW, "L", "score") +
      " " +
      head("published", dateW, "R", "published") +
      " " +
      head("spark", sparkW, "R");

    const lines: string[] = [];
    lines.push(header);
    lines.push(th.fg("borderMuted", " " + "─".repeat(Math.max(0, bodyW - 1))));

    const page = visible.slice(this.scroll, this.scroll + PAGE_SIZE);
    for (const pkg of page) {
      const ready = pkg.downloadsReady;
      const name = padR(clip(pkg.name, nameW), nameW);
      const ver = padR(clip(pkg.version || "-", verW), verW);
      const day = padL(formatNum(pkg.day, ready), dayW);
      const week = padL(formatNum(pkg.week, ready), weekW);
      const month = padL(formatNum(pkg.month, ready), monthW);
      const scoreRaw = padL(formatScore(pkg.searchScore), scoreW);
      const scoreTone =
        pkg.searchScore === 0 && pkg.keywords.includes("pi-package")
          ? ("warning" as const)
          : undefined;
      const published = padR(formatDate(pkg.published), dateW);
      const spark = padR(sparkline(pkg.daily, sparkW, ready), sparkW);

      const line =
        " " +
        cell(name, "name", sort === "name" ? undefined : "accent") +
        " " +
        cell(ver, "ver") +
        " " +
        cell(day, "day") +
        " " +
        cell(week, "week") +
        " " +
        cell(month, "month") +
        " " +
        cell(scoreRaw, "score", scoreTone) +
        " " +
        cell(published, "published") +
        " " +
        spark;

      lines.push(line);
      if (pkg.error) {
        lines.push(th.fg("warning", `   ! ${clip(pkg.error, Math.max(10, bodyW - 4))}`));
      }
    }

    if (visible.length > PAGE_SIZE) {
      const moreAbove = this.scroll > 0;
      const moreBelow = this.scroll + PAGE_SIZE < visible.length;
      if (moreAbove || moreBelow) {
        lines.push(
          th.fg(
            "dim",
            ` ${moreAbove ? "↑ more" : "      "}   ${moreBelow ? "↓ more" : ""}`,
          ),
        );
      }
    }

    return lines;
  }
}
