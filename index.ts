import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseArgs } from "./core/args";
import { loadConfig, saveQueryPrefs } from "./core/config";
import { applyLimit, fetchPackageStatsProgressive } from "./core/fetch";
import {
  formatDate,
  formatNum,
  formatScore,
  isCloseKey,
  sparkline,
} from "./ui/format";
import { StatsWindow, type ReloadOpts } from "./ui/stats-window";
import type { PackageStats, QueryOptions } from "./types";

function textTable(rows: PackageStats[], query: QueryOptions): string {
  const sorted = applyLimit(rows, query.sort, query.limit);
  const lines = [
    "package              ver     day  week month  score  published   spark",
    "-------------------- ------- ---- ----- ------ ------ ---------- -------",
  ];
  for (const p of sorted) {
    lines.push(
      [
        p.name.padEnd(20).slice(0, 20),
        (p.version || "-").padEnd(7).slice(0, 7),
        formatNum(p.day, p.downloadsReady).padStart(4),
        formatNum(p.week, p.downloadsReady).padStart(5),
        formatNum(p.month, p.downloadsReady).padStart(6),
        formatScore(p.searchScore).padStart(6),
        formatDate(p.published).padEnd(10),
        sparkline(p.daily, 7, p.downloadsReady),
      ].join(" "),
    );
  }
  return lines.join("\n");
}

function queryLabel(q: QueryOptions): string {
  const prefix = q.prefix === "" ? "(none)" : q.prefix;
  const force = q.force ? " force" : "";
  return `author:${q.author} prefix:${prefix} sort:${q.sort} top${q.limit}${force}`;
}

export default function register(pi: ExtensionAPI) {
  pi.registerCommand("npm-stats", {
    description:
      "npm download/stats panel. /npm-stats [author] [--prefix p] [--limit n] [--sort key] [--force]",
    handler: async (_args, ctx) => {
      const cfg = loadConfig();
      const { query, warnings } = parseArgs(_args, cfg);

      for (const w of warnings) {
        ctx.ui.notify(w, "warning");
      }

      if (!query.author) {
        ctx.ui.notify(
          'npm-stats needs an author. Try: /npm-stats <npm-username>  or set { "author": "..." } in pi-npm-stats.json',
          "warning",
        );
        return;
      }

      // Persist prefs once author is present (before network).
      try {
        saveQueryPrefs(query);
      } catch (err) {
        ctx.ui.notify(
          `failed to save pi-npm-stats.json: ${err instanceof Error ? err.message : String(err)}`,
          "warning",
        );
      }

      if (ctx.mode !== "tui") {
        ctx.ui.notify(`Fetching npm stats (${queryLabel(query)})…`, "info");
        try {
          const rows = await fetchPackageStatsProgressive(query, () => {});
          ctx.ui.notify(
            rows.length
              ? `${queryLabel(query)} matched ${rows.length}\n${textTable(rows, query)}`
              : `No packages found (${queryLabel(query)})`,
            "info",
          );
        } catch (err) {
          ctx.ui.notify(
            `npm-stats failed: ${err instanceof Error ? err.message : String(err)}`,
            "error",
          );
        }
        return;
      }

      let handle: { focus: () => void; isFocused: () => boolean } | undefined;
      let abort: AbortController | undefined;
      let loading = false;
      let opened = false;

      await ctx.ui.custom<void>(
        (tui, theme, _kb, done) => {
          const unsubscribeInput = ctx.ui.onTerminalInput((data) => {
            if (!isCloseKey(data) || handle?.isFocused()) return;
            handle?.focus();
            return { data };
          });

          let panel: StatsWindow;

          const finish = () => {
            abort?.abort();
            done();
          };

          const load = (opts?: ReloadOpts) => {
            if (loading) abort?.abort();
            loading = true;

            const force = opts?.force === true;
            // Panel is the source of truth for sort/filters while open.
            const q: QueryOptions = { ...panel.getQuery(), force };
            abort = new AbortController();
            const signal = abort.signal;

            // First open or force refresh: clear table. Soft reload (sort switch): keep rows.
            const mode: "full" | "soft" = !opened || force ? "full" : "soft";
            opened = true;
            panel.setLoading(q, mode);

            void fetchPackageStatsProgressive(
              q,
              (state) => {
                if (signal.aborted) return;
                panel.setProgress(
                  state.matched,
                  state.loaded,
                  state.total,
                  state.done,
                  state.cacheHits,
                );
              },
              signal,
            )
              .catch((err) => {
                if (signal.aborted) return;
                panel.setError(
                  `Failed: ${err instanceof Error ? err.message : String(err)}`,
                );
              })
              .finally(() => {
                if (!signal.aborted) loading = false;
              });
          };

          panel = new StatsWindow(
            theme,
            finish,
            () => tui.requestRender(),
            query,
            (opts) => load(opts),
            unsubscribeInput,
          );
          load({ force: query.force });
          return panel;
        },
        {
          overlay: true,
          overlayOptions: {
            width: "90%",
            minWidth: 78,
            maxWidth: 120,
            maxHeight: "80%",
            anchor: "center",
          },
          onHandle: (overlayHandle) => {
            handle = overlayHandle;
          },
        },
      );
    },
  });
}
