import { Key, matchesKey } from "@earendil-works/pi-tui";

const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

export function visibleWidth(text: string): number {
  return text.replace(ANSI_RE, "").length;
}

export function truncateToWidth(text: string, width: number): string {
  let out = "";
  let used = 0;
  for (let i = 0; i < text.length; ) {
    if (text[i] === "\x1b") {
      const match = text.slice(i).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
      if (match) {
        out += match[0];
        i += match[0].length;
        continue;
      }
    }
    if (used + 1 > width) break;
    out += text[i]!;
    used++;
    i++;
  }
  return out;
}

function matchesKittyKey(data: string, codepoint: number, modifier = 0): boolean {
  const match = data.match(/^\x1b\[(\d+)(?::\d*)?(?::\d+)?(?:;(\d+))?(?::\d+)?u$/);
  if (!match) return false;
  const keyCodepoint = Number(match[1]);
  const keyModifier = Number(match[2] ?? "1") - 1;
  return keyCodepoint === codepoint && keyModifier === modifier;
}

function matchesModifyOtherKey(data: string, codepoint: number, modifier = 0): boolean {
  const match = data.match(/^\x1b\[27;(\d+);(\d+)~$/);
  if (!match) return false;
  const keyModifier = Number(match[1]) - 1;
  const keyCodepoint = Number(match[2]);
  return keyCodepoint === codepoint && keyModifier === modifier;
}

export function isCloseKey(data: string): boolean {
  return (
    matchesKey(data, Key.escape) ||
    matchesKey(data, "q") ||
    matchesKey(data, Key.shift("q")) ||
    matchesKey(data, Key.ctrl("c")) ||
    data === "\x1b" ||
    data === "\x03" ||
    // fallbacks for terminals without Kitty decode on bare Esc
    matchesKittyKey(data, 27) ||
    matchesModifyOtherKey(data, 27) ||
    matchesKittyKey(data, 113) ||
    matchesKittyKey(data, 81) ||
    matchesKittyKey(data, 99, 4) ||
    matchesModifyOtherKey(data, 99, 4)
  );
}

export function isUpKey(data: string): boolean {
  return matchesKey(data, "k") || matchesKey(data, Key.shift("k")) || matchesKey(data, Key.up);
}

export function isDownKey(data: string): boolean {
  return matchesKey(data, "j") || matchesKey(data, Key.shift("j")) || matchesKey(data, Key.down);
}

export function isLeftKey(data: string): boolean {
  return matchesKey(data, "h") || matchesKey(data, Key.shift("h")) || matchesKey(data, Key.left);
}

export function isRightKey(data: string): boolean {
  return matchesKey(data, "l") || matchesKey(data, Key.shift("l")) || matchesKey(data, Key.right);
}

export function isPageUpKey(data: string): boolean {
  return matchesKey(data, "b") || matchesKey(data, Key.shift("b")) || matchesKey(data, Key.pageUp);
}

export function isPageDownKey(data: string): boolean {
  return (
    matchesKey(data, Key.space) ||
    matchesKey(data, "f") ||
    matchesKey(data, Key.shift("f")) ||
    matchesKey(data, Key.pageDown)
  );
}

export function isHomeKey(data: string): boolean {
  return matchesKey(data, "g") || matchesKey(data, Key.home);
}

export function isEndKey(data: string): boolean {
  return matchesKey(data, Key.shift("g")) || matchesKey(data, Key.end);
}

export function isRefreshKey(data: string): boolean {
  return matchesKey(data, "r") || matchesKey(data, Key.shift("r"));
}

export function isSortNextKey(data: string): boolean {
  return matchesKey(data, "s") || matchesKey(data, Key.shift("s"));
}

export function clip(s: string, w: number): string {
  return s.length > w ? `${s.slice(0, Math.max(0, w - 1))}…` : s;
}

export function padR(s: string, w: number): string {
  const c = clip(s, w);
  return c + " ".repeat(Math.max(0, w - c.length));
}

export function padL(s: string, w: number): string {
  const c = clip(s, w);
  return " ".repeat(Math.max(0, w - c.length)) + c;
}

export function formatNum(n: number, ready = true): string {
  if (!ready) return "…";
  if (!Number.isFinite(n)) return "-";
  if (n === 0) return "0";
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatScore(n: number): string {
  if (!Number.isFinite(n)) return "-";
  if (n === 0) return "0";
  if (n >= 100) return String(Math.round(n));
  return n.toFixed(1);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toISOString().slice(0, 10);
}

export function sparkline(values: number[] | undefined, width = 7, ready = true): string {
  if (!ready) return "…".padEnd(width, " ");
  if (!values || !values.length) return " ".repeat(width);
  const data = values.slice(-width);
  while (data.length < width) data.unshift(0);
  const max = Math.max(...data, 1);
  return data
    .map((v) => {
      const n = Number.isFinite(v) ? v : 0;
      const idx = Math.max(
        0,
        Math.min(SPARK.length - 1, Math.round((n / max) * (SPARK.length - 1))),
      );
      return SPARK[idx];
    })
    .join("");
}

export function formatTime(d: Date): string {
  return d.toTimeString().slice(0, 8);
}
