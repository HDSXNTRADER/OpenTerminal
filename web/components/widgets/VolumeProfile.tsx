"use client";

import { useEffect, useReducer } from "react";
import type { Candle } from "../../lib/api";
import { fmt } from "../../lib/api";
import type { ChartApi } from "./ChartDrawings";

const BINS = 40;

/**
 * Volume-by-price histogram for the bars currently on screen, drawn at the
 * right edge of the chart. Each bar's volume is spread evenly over its
 * high-low range. Highlights the point of control (busiest price) and the
 * value area (the 70% of volume around it).
 */
export default function VolumeProfile({ api, candles }: { api: ChartApi | null; candles: Candle[] }) {
  const [, redraw] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (!api) return;
    const ts = api.chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(redraw);
    const el = api.chart.chartElement();
    const ro = new ResizeObserver(() => redraw());
    ro.observe(el);
    el.addEventListener("pointermove", redraw);
    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(redraw);
      ro.disconnect();
      el.removeEventListener("pointermove", redraw);
    };
  }, [api]);

  if (!api || candles.length === 0) return null;
  const range = api.chart.timeScale().getVisibleLogicalRange();
  const from = Math.max(0, Math.floor(range?.from ?? 0));
  const to = Math.min(candles.length - 1, Math.ceil(range?.to ?? candles.length - 1));
  const visible = candles.slice(from, to + 1);
  if (visible.length < 2) return null;

  let lo = Infinity;
  let hi = -Infinity;
  for (const c of visible) {
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
  }
  if (!(hi > lo)) return null;
  const step = (hi - lo) / BINS;
  const vol = new Array<number>(BINS).fill(0);
  for (const c of visible) {
    const a = Math.min(BINS - 1, Math.floor((c.low - lo) / step));
    const b = Math.min(BINS - 1, Math.floor((c.high - lo) / step));
    const share = (c.volume || 0) / (b - a + 1);
    for (let i = a; i <= b; i++) vol[i] += share;
  }
  const total = vol.reduce((x, y) => x + y, 0);
  if (total === 0) return null;
  const poc = vol.indexOf(Math.max(...vol));

  // Value area: grow outwards from the POC until 70% of the volume is covered.
  let inArea = vol[poc];
  let low = poc;
  let high = poc;
  while (inArea < total * 0.7 && (low > 0 || high < BINS - 1)) {
    const down = low > 0 ? vol[low - 1] : -1;
    const up = high < BINS - 1 ? vol[high + 1] : -1;
    if (up >= down) inArea += vol[++high];
    else inArea += vol[--low];
  }

  const plotWidth = api.chart.timeScale().width();
  const maxW = plotWidth * 0.25;
  const maxV = vol[poc];
  const bars = vol.map((v, i) => {
    const yTop = api.series.priceToCoordinate(lo + (i + 1) * step);
    const yBot = api.series.priceToCoordinate(lo + i * step);
    if (yTop === null || yBot === null || v === 0) return null;
    const w = (v / maxV) * maxW;
    const fill = i === poc ? "var(--amber)" : i >= low && i <= high ? "var(--text-dim)" : "var(--border)";
    return <rect key={i} x={plotWidth - w} y={yTop + 0.5} width={w} height={Math.max(1, yBot - yTop - 1)} fill={fill} opacity={i === poc ? 0.55 : 0.35} />;
  });
  const pocY = api.series.priceToCoordinate(lo + (poc + 0.5) * step);

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none z-[4]">
      {bars}
      {pocY !== null && (
        <text x={plotWidth - maxW} y={pocY - 3} fill="var(--amber)" fontSize={10}>
          POC {fmt(lo + (poc + 0.5) * step)}
        </text>
      )}
    </svg>
  );
}
