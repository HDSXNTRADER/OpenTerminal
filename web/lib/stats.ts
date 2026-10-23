import type { Candle } from "./api";

/** Pearson correlation of two equal-length series; null when undefined. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  return va === 0 || vb === 0 ? null : cov / Math.sqrt(va * vb);
}

/** Daily returns keyed by UTC date, so series from different exchanges line up. */
export function returnsByDay(candles: Candle[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    if (prev > 0) out.set(new Date(candles[i].time * 1000).toISOString().slice(0, 10), candles[i].close / prev - 1);
  }
  return out;
}

/** Monthly % returns from monthly bars: { year, month (0-11), ret }. */
export function monthlyReturns(candles: Candle[]): Array<{ year: number; month: number; ret: number }> {
  const out: Array<{ year: number; month: number; ret: number }> = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    if (!(prev > 0)) continue;
    const d = new Date(candles[i].time * 1000);
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth(), ret: (candles[i].close / prev - 1) * 100 });
  }
  return out;
}
