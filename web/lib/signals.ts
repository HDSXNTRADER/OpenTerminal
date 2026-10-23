import type { Candle } from "./api";
import { rsi, sma, type Point } from "./indicators";

export type Signal = { kind: string; bullish: boolean; label: string };

const LOOKBACK = 3; // bars: a signal counts if it happened in the last few sessions

const lastN = (p: Point[], n: number) => p.slice(-n);

/** Did series a cross above (dir = 1) / below (dir = -1) series b within the last `n` bars? */
function crossed(a: Point[], b: Point[], dir: 1 | -1, n = LOOKBACK): boolean {
  const bm = new Map(b.map((p) => [p.time, p.value]));
  const pts = lastN(a, n + 1);
  for (let i = 1; i < pts.length; i++) {
    const b0 = bm.get(pts[i - 1].time);
    const b1 = bm.get(pts[i].time);
    if (b0 === undefined || b1 === undefined) continue;
    if (dir === 1 && pts[i - 1].value <= b0 && pts[i].value > b1) return true;
    if (dir === -1 && pts[i - 1].value >= b0 && pts[i].value < b1) return true;
  }
  return false;
}

/**
 * Classic technical events on daily bars. Labels are English keys for t().
 * Needs ~1 year of daily candles for the 200-day average and 52-week range.
 */
export function detectSignals(candles: Candle[]): Signal[] {
  const out: Signal[] = [];
  if (candles.length < 30) return out;
  const close: Point[] = candles.map((c) => ({ time: c.time, value: c.close }));
  const last = candles[candles.length - 1];

  if (candles.length >= 201) {
    const ma200 = sma(candles, 200);
    if (crossed(close, ma200, 1)) out.push({ kind: "ma200-up", bullish: true, label: "Crossed above the 200-day average" });
    if (crossed(close, ma200, -1)) out.push({ kind: "ma200-down", bullish: false, label: "Crossed below the 200-day average" });
    const ma50 = sma(candles, 50);
    if (crossed(ma50, ma200, 1, 5)) out.push({ kind: "golden", bullish: true, label: "Golden cross (50-day over 200-day)" });
    if (crossed(ma50, ma200, -1, 5)) out.push({ kind: "death", bullish: false, label: "Death cross (50-day under 200-day)" });
  }

  const year = candles.slice(-253, -LOOKBACK);
  if (year.length > 100) {
    const hi = Math.max(...year.map((c) => c.high));
    const lo = Math.min(...year.map((c) => c.low));
    const recent = candles.slice(-LOOKBACK);
    if (recent.some((c) => c.close > hi)) out.push({ kind: "52w-high", bullish: true, label: "New 52-week high" });
    if (recent.some((c) => c.close < lo)) out.push({ kind: "52w-low", bullish: false, label: "New 52-week low" });
  }

  const r = rsi(candles);
  const rLast = r[r.length - 1]?.value;
  if (rLast !== undefined && rLast > 70) out.push({ kind: "rsi-high", bullish: false, label: "RSI above 70 (overbought)" });
  if (rLast !== undefined && rLast < 30) out.push({ kind: "rsi-low", bullish: true, label: "RSI below 30 (oversold)" });

  const vol20 = candles.slice(-21, -1);
  const avgVol = vol20.reduce((a, c) => a + c.volume, 0) / (vol20.length || 1);
  if (avgVol > 0 && last.volume > 2 * avgVol) out.push({ kind: "volume", bullish: last.close >= last.open, label: "Volume above 2× the 20-day average" });

  return out;
}
