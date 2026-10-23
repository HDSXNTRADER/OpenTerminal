import type { Candle } from "./providers/yahoo.js";

/**
 * Chart timeframes ("bar intervals") such as 1m, 15m, 4h, 1D, 2W, 1M or any
 * custom multiple like 3m, 45m, 3D. Providers only serve a handful of native
 * intervals, so we fetch the closest native one that divides the target and
 * resample the candles here.
 */

export type Unit = "s" | "m" | "h" | "D" | "W" | "M";
export type Interval = { n: number; unit: Unit; /** approximate bar length */ seconds: number; key: string };

const UNIT_SECONDS: Record<Unit, number> = { s: 1, m: 60, h: 3600, D: 86_400, W: 604_800, M: 2_592_000 };
const MAX_N: Record<Unit, number> = { s: 3600, m: 1440, h: 168, D: 365, W: 104, M: 60 };

/** Parse "30s", "15m", "4h", "1D", "2W", "1M". Lowercase d/w are accepted; "m" is always minutes. */
export function parseInterval(raw: string | undefined | null): Interval | null {
  const m = /^(\d{1,4})\s*(s|m|min|h|d|D|w|W|M|mo)$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2];
  const unit: Unit =
    u === "s" ? "s" : u === "m" || u === "min" ? "m" : u === "h" ? "h" : u === "d" || u === "D" ? "D" : u === "w" || u === "W" ? "W" : "M";
  if (n < 1 || n > MAX_N[unit]) return null;
  return { n, unit, seconds: n * UNIT_SECONDS[unit], key: `${n}${unit}` };
}

export const isIntraday = (iv: Interval) => iv.unit === "s" || iv.unit === "m" || iv.unit === "h";

/** Sub-minute bars: only sources with second-level data (Binance) can serve these. */
export const isSubMinute = (iv: Interval) => iv.seconds < 60;

const DAY_MS = 86_400_000;

/** Start of the window (ms) for a terminal range key. */
export function rangeStart(rangeKey: string, now = Date.now()): number {
  const year = new Date(now).getUTCFullYear();
  const map: Record<string, number> = {
    // 1D asks for a few days back so weekends/holidays still return the last session.
    "1D": now - 5 * DAY_MS,
    "5D": now - 8 * DAY_MS,
    "1M": now - 31 * DAY_MS,
    "3M": now - 92 * DAY_MS,
    "6M": now - 183 * DAY_MS,
    YTD: Date.UTC(year, 0, 1),
    "1Y": now - 366 * DAY_MS,
    "2Y": now - 2 * 366 * DAY_MS,
    "5Y": now - 5 * 366 * DAY_MS,
    "10Y": now - 10 * 366 * DAY_MS,
    MAX: Date.UTC(1970, 0, 1),
  };
  return map[rangeKey] ?? map["6M"];
}

/**
 * Pick the largest native interval that evenly builds the target. Native
 * intraday sizes are given in minutes (1/60 = one second).
 */
export function pickBase<T extends string>(
  iv: Interval,
  natives: { minutes: Array<[number, T]>; day: T; week?: T; month?: T }
): { base: T; baseMinutes: number } {
  if (isIntraday(iv)) {
    const sec = (minutes: number) => Math.round(minutes * 60);
    let best = natives.minutes[0];
    for (const cand of natives.minutes) if (iv.seconds % sec(cand[0]) === 0 && cand[0] >= best[0]) best = cand;
    return { base: best[1], baseMinutes: best[0] };
  }
  if (iv.unit === "M" && natives.month) return { base: natives.month, baseMinutes: 43_200 };
  if (iv.unit === "W" && natives.week) return { base: natives.week, baseMinutes: 10_080 };
  return { base: natives.day, baseMinutes: 1440 };
}

function merge(bars: Candle[]): Candle {
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  for (const b of bars) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
    volume += b.volume || 0;
  }
  return { time: bars[0].time, open: bars[0].open, high, low, close: bars[bars.length - 1].close, volume };
}

function utcDay(t: number): number {
  return Math.floor(t / 86_400);
}

/** Calendar group key for daily-or-larger timeframes. */
function calendarKey(t: number, unit: Unit): number {
  const d = new Date(t * 1000);
  if (unit === "M") return d.getUTCFullYear() * 12 + d.getUTCMonth();
  if (unit === "W") return Math.floor((utcDay(t) + 3) / 7); // weeks start on Monday (1970-01-01 was a Thursday)
  return utcDay(t);
}

/**
 * Resample ascending candles into the target interval.
 * - Intraday: buckets are aligned to each day's first bar, so 1h/4h bars on a
 *   09:30 session start at 09:30 (like most charting platforms); for 24h
 *   markets that is simply midnight UTC.
 * - Daily and up: bars are grouped by calendar day/week/month, then every N
 *   consecutive groups are merged (2D, 3W, 3M...).
 */
export function resample(candles: Candle[], iv: Interval): Candle[] {
  if (candles.length === 0) return [];
  const out: Candle[] = [];
  let bucket: Candle[] = [];
  let bucketKey: number | null = null;

  if (isIntraday(iv)) {
    const sec = iv.seconds;
    let anchorDay = -1;
    let anchor = 0;
    for (const c of candles) {
      const day = utcDay(c.time);
      if (sec < 86_400 && day !== anchorDay) {
        anchorDay = day;
        anchor = c.time;
      }
      const key = anchor + Math.floor((c.time - anchor) / sec) * sec;
      if (bucketKey !== null && key !== bucketKey) {
        out.push(merge(bucket));
        bucket = [];
      }
      bucketKey = key;
      bucket.push(c);
    }
    if (bucket.length) out.push(merge(bucket));
    return out;
  }

  // Daily+: first group by calendar unit, then merge N consecutive groups.
  const groups: Candle[][] = [];
  for (const c of candles) {
    const key = calendarKey(c.time, iv.unit);
    if (bucketKey !== null && key === bucketKey) bucket.push(c);
    else {
      if (bucket.length) groups.push(bucket);
      bucket = [c];
      bucketKey = key;
    }
  }
  if (bucket.length) groups.push(bucket);
  for (let i = 0; i < groups.length; i += iv.n) out.push(merge(groups.slice(i, i + iv.n).flat()));
  return out;
}

/** Keep only the most recent session (UTC day) — used by the 1D range on exchange-traded symbols. */
export function lastSession(candles: Candle[]): Candle[] {
  if (candles.length === 0) return candles;
  const last = utcDay(candles[candles.length - 1].time);
  return candles.filter((c) => utcDay(c.time) === last);
}

/**
 * How many days back Yahoo-style sources (Yahoo itself, OpenBB's yfinance)
 * serve bars of a given size: 1m ~7 days, sub-hour ~60 days, hourly ~2 years.
 */
export function intradayLookbackDays(baseMinutes: number): number {
  if (baseMinutes >= 1440) return Infinity;
  if (baseMinutes <= 1) return 7;
  if (baseMinutes < 60) return 59;
  return 729;
}
