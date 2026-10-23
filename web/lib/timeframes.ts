/** Chart timeframes and ranges shared by the chart widgets. */

export const RANGES = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
export type Range = (typeof RANGES)[number];
// "AUTO" lets the server pick a bar size that suits the range (the original behaviour).
export const INTERVALS = ["AUTO", "30s", "1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W", "1M"] as const;
const RANGE_DAYS: Record<Range, number> = {
  "1D": 1, "5D": 5, "1M": 31, "3M": 92, "6M": 183, YTD: 366, "1Y": 366, "5Y": 1830, MAX: 20_000,
};
const UNIT_MINUTES: Record<string, number> = { s: 1 / 60, m: 1, h: 60, D: 1440, W: 10_080, M: 43_200 };

/** Bar length in minutes for "30s", "15m", "4h", "1D", "2W", "1M"... or null if not a valid timeframe. */
export function intervalMinutes(iv: string): number | null {
  const m = /^(\d{1,4})(s|m|h|D|W|M)$/.exec(iv);
  return m && Number(m[1]) > 0 ? Number(m[1]) * UNIT_MINUTES[m[2]] : null;
}

/** Normalise user input like "45 min", "2H", "3d" to the server's format. */
export function normalizeInterval(raw: string): string | null {
  const t = raw.trim();
  // Capital M is months (like TradingView); lowercase m is minutes.
  if (/^\d{1,4}M$/.test(t)) return intervalMinutes(t) ? t : null;
  const m = /^(\d{1,4})\s*(s|sec|m|min|h|d|w|mo)$/i.exec(t);
  if (!m) return null;
  const u = m[2].toLowerCase();
  const unit = u.startsWith("s") ? "s" : u === "mo" ? "M" : u.startsWith("m") ? "m" : u === "h" ? "h" : u === "d" ? "D" : "W";
  const iv = `${Number(m[1])}${unit}`;
  return intervalMinutes(iv) ? iv : null;
}

/**
 * Whether a range makes sense for a bar size: free data sources only keep
 * fine bars for a short window (1m ~7 days, under 1h ~60 days, hourly ~2
 * years, seconds a few hours), and a range should hold at least two bars.
 */
export function rangeAllowed(range: Range, interval: string): boolean {
  if (interval === "AUTO") return true;
  const mins = intervalMinutes(interval);
  if (!mins) return true;
  const days = RANGE_DAYS[range];
  if (mins < 1 && days > 1) return false;
  if (mins === 1 && days > 5) return false;
  if (mins < 60 && days > 31) return false;
  if (mins < 1440 && days > 366) return false;
  return (days * 1440) / mins >= 2;
}

/** A sensible default range for a bar size (enough bars, within what free sources keep). */
export function defaultRange(interval: string): Range {
  const mins = intervalMinutes(interval);
  if (mins === null) return "6M";
  if (mins <= 1) return "1D";
  if (mins < 60) return "5D";
  if (mins < 1440) return "1M";
  if (mins < 10_080) return "1Y";
  if (mins < 43_200) return "5Y";
  return "MAX";
}
