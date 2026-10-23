"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type SeriesType } from "lightweight-charts";
import { fmt, type Candle } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useTerminal, type Drawing, type DrawingPoint } from "../../store/terminal";

export type DrawTool = "trend" | "fib" | "hline" | "alert" | "erase" | null;

export const DRAW_TOOLS: Array<{ id: Exclude<DrawTool, null>; icon: string; label: string }> = [
  { id: "trend", icon: "╱", label: "Trend line: click two points" },
  { id: "hline", icon: "─", label: "Horizontal line (support/resistance): one click" },
  { id: "fib", icon: "FIB", label: "Fibonacci retracement: click the start and end of the move" },
  { id: "alert", icon: "🔔", label: "Price alert: click the price level" },
  { id: "erase", icon: "⌫", label: "Eraser: click a drawing or alert line to delete it" },
];

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const COLOR = "#4fc3f7";
const HIT_PX = 8;

export type ChartApi = { chart: IChartApi; series: ISeriesApi<SeriesType> };

/**
 * Bar times -> fractional bar index (and back). Drawings are stored as
 * time + price, so they line up on any timeframe; between bars we
 * interpolate, beyond the data we extrapolate with the edge bar spacing.
 */
function timeToLogical(candles: Candle[], time: number): number {
  const n = candles.length;
  if (n === 0) return 0;
  if (n === 1) return 0;
  if (time <= candles[0].time) return (time - candles[0].time) / (candles[1].time - candles[0].time || 1);
  if (time >= candles[n - 1].time) return n - 1 + (time - candles[n - 1].time) / (candles[n - 1].time - candles[n - 2].time || 1);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= time) lo = mid;
    else hi = mid;
  }
  return lo + (time - candles[lo].time) / (candles[hi].time - candles[lo].time || 1);
}

function logicalToTime(candles: Candle[], logical: number): number {
  const n = candles.length;
  if (n === 0) return 0;
  if (n === 1) return candles[0].time;
  if (logical <= 0) return candles[0].time + logical * (candles[1].time - candles[0].time);
  if (logical >= n - 1) return candles[n - 1].time + (logical - (n - 1)) * (candles[n - 1].time - candles[n - 2].time);
  const i = Math.floor(logical);
  return candles[i].time + (logical - i) * (candles[i + 1].time - candles[i].time);
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const k = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len));
  return Math.hypot(px - (x1 + k * dx), py - (y1 + k * dy));
}

const uid = () => `d-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * SVG layer over the chart for trend lines and Fibonacci, plus native price
 * lines for horizontal levels and alerts. Drawings are saved per symbol.
 */
export default function DrawingLayer({
  api,
  candles,
  symbol,
  tool,
  onDone,
}: {
  api: ChartApi | null;
  candles: Candle[];
  symbol: string;
  tool: DrawTool;
  onDone: () => void;
}) {
  const drawings = useTerminal((s) => s.drawings[symbol]) ?? EMPTY;
  const alerts = useTerminal((s) => s.alerts);
  const addDrawing = useTerminal((s) => s.addDrawing);
  const removeDrawing = useTerminal((s) => s.removeDrawing);
  const addAlert = useTerminal((s) => s.addAlert);
  const removeAlert = useTerminal((s) => s.removeAlert);
  const symbolAlerts = useMemo(() => alerts.filter((a) => a.symbol === symbol && a.triggeredAt === null), [alerts, symbol]);

  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const [pending, setPending] = useState<DrawingPoint | null>(null);
  const [hover, setHover] = useState<DrawingPoint | null>(null);
  const pendingPx = useRef({ x: 0, y: 0 });

  // Keep the latest values for the chart callbacks, which are subscribed once per chart.
  const live = useRef({ tool, pending, drawings, symbolAlerts, candles, onDone });
  live.current = { tool, pending, drawings, symbolAlerts, candles, onDone };

  useEffect(() => setPending(null), [tool, symbol]);

  const toScreen = (p: DrawingPoint): { x: number; y: number } | null => {
    if (!api) return null;
    const x = api.chart.timeScale().logicalToCoordinate(timeToLogical(candles, p.time) as never);
    const y = api.series.priceToCoordinate(p.price);
    return x === null || y === null ? null : { x, y };
  };

  useEffect(() => {
    if (!api) return;
    const { chart, series } = api;
    const fromParam = (point: { x: number; y: number } | undefined): DrawingPoint | null => {
      if (!point) return null;
      const logical = chart.timeScale().coordinateToLogical(point.x);
      const price = series.coordinateToPrice(point.y);
      if (logical === null || price === null) return null;
      return { time: Math.round(logicalToTime(live.current.candles, logical)), price };
    };

    const onClick = (param: { point?: { x: number; y: number } }) => {
      const { tool, pending, drawings, symbolAlerts, candles, onDone } = live.current;
      const p = fromParam(param.point);
      if (!tool || !p || !param.point) return;
      if (tool === "hline") {
        addDrawing(symbol, { id: uid(), kind: "hline", price: p.price });
        onDone();
      } else if (tool === "alert") {
        const last = candles[candles.length - 1]?.close ?? p.price;
        addAlert(symbol, p.price, p.price < last ? "below" : "above");
        onDone();
      } else if (tool === "trend" || tool === "fib") {
        if (!pending) {
          setPending(p);
          pendingPx.current = param.point;
        } else if (Math.hypot(param.point.x - pendingPx.current.x, param.point.y - pendingPx.current.y) > 3) {
          addDrawing(symbol, { id: uid(), kind: tool, a: pending, b: p });
          setPending(null);
          onDone();
        }
      } else if (tool === "erase") {
        const { x, y } = param.point;
        let best: { d: number; remove: () => void } | null = null;
        const consider = (d: number, remove: () => void) => {
          if (d <= HIT_PX && (!best || d < best.d)) best = { d, remove };
        };
        for (const d of drawings) {
          if (d.kind === "hline") {
            const yy = series.priceToCoordinate(d.price);
            if (yy !== null) consider(Math.abs(yy - y), () => removeDrawing(symbol, d.id));
            continue;
          }
          const a = toScreenWith(chart, series, candles, d.a);
          const b = toScreenWith(chart, series, candles, d.b);
          if (!a || !b) continue;
          if (d.kind === "trend") consider(distToSegment(x, y, a.x, a.y, b.x, b.y), () => removeDrawing(symbol, d.id));
          else
            for (const lvl of FIB_LEVELS) {
              const yy = series.priceToCoordinate(d.b.price + (d.a.price - d.b.price) * lvl);
              if (yy !== null && x >= Math.min(a.x, b.x) - HIT_PX) consider(Math.abs(yy - y), () => removeDrawing(symbol, d.id));
            }
        }
        for (const al of symbolAlerts) {
          const yy = series.priceToCoordinate(al.price);
          if (yy !== null) consider(Math.abs(yy - y), () => removeAlert(al.id));
        }
        (best as { remove: () => void } | null)?.remove();
      }
    };
    const onMove = (param: { point?: { x: number; y: number } }) => {
      if (live.current.pending) setHover(fromParam(param.point));
    };
    chart.subscribeClick(onClick);
    // The chart reports a second click within ~0.5s as a double-click only, so treat it as a click too.
    chart.subscribeDblClick(onClick);
    chart.subscribeCrosshairMove(onMove);
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    const ro = new ResizeObserver(() => redraw());
    ro.observe(chart.chartElement());
    // Price-axis drags don't fire a time-scale event, so refresh on pointer moves too.
    const el = chart.chartElement();
    el.addEventListener("pointermove", redraw);
    el.addEventListener("wheel", redraw);
    return () => {
      chart.unsubscribeClick(onClick);
      chart.unsubscribeDblClick(onClick);
      chart.unsubscribeCrosshairMove(onMove);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
      ro.disconnect();
      el.removeEventListener("pointermove", redraw);
      el.removeEventListener("wheel", redraw);
    };
  }, [api, symbol, addDrawing, removeDrawing, addAlert, removeAlert]);

  // Horizontal levels and alerts use native price lines, so they get a label on the price axis.
  useEffect(() => {
    if (!api) return;
    const lines: IPriceLine[] = [];
    for (const d of drawings)
      if (d.kind === "hline")
        lines.push(api.series.createPriceLine({ price: d.price, color: COLOR, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "" }));
    for (const a of symbolAlerts)
      lines.push(
        api.series.createPriceLine({
          price: a.price,
          color: "#ffd966",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `🔔 ${a.direction === "above" ? "≥" : "≤"}`,
        })
      );
    return () => {
      try {
        for (const l of lines) api.series.removePriceLine(l);
      } catch {
        // The chart was already torn down.
      }
    };
  }, [api, drawings, symbolAlerts]);

  if (!api) return null;
  const width = api.chart.chartElement().clientWidth;

  const shapes: React.ReactNode[] = [];
  const all: Drawing[] = [...drawings];
  if (pending && hover && (tool === "trend" || tool === "fib")) all.push({ id: "preview", kind: tool, a: pending, b: hover });
  for (const d of all) {
    if (d.kind === "hline") continue;
    const a = toScreen(d.a);
    const b = toScreen(d.b);
    if (!a || !b) continue;
    const opacity = d.id === "preview" ? 0.6 : 1;
    if (d.kind === "trend") {
      shapes.push(<line key={d.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={COLOR} strokeWidth={1.5} opacity={opacity} />);
      continue;
    }
    const x0 = Math.min(a.x, b.x);
    for (const lvl of FIB_LEVELS) {
      // 0% sits at the end of the move, 100% at its start (classic retracement).
      const price = d.b.price + (d.a.price - d.b.price) * lvl;
      const y = api.series.priceToCoordinate(price);
      if (y === null) continue;
      shapes.push(
        <g key={`${d.id}-${lvl}`} opacity={opacity}>
          <line x1={x0} y1={y} x2={width} y2={y} stroke="#ff9900" strokeWidth={1} strokeDasharray={lvl === 0 || lvl === 1 ? undefined : "4 3"} />
          <text x={x0 + 4} y={y - 2} fill="#ff9900" fontSize={10}>
            {(lvl * 100).toFixed(1)}% · {fmt(price)}
          </text>
        </g>
      );
    }
    shapes.push(<line key={`${d.id}-diag`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ff9900" strokeWidth={1} strokeDasharray="2 3" opacity={0.6 * opacity} />);
  }
  if (pending) {
    const p = toScreen(pending);
    if (p) shapes.push(<circle key="pending" cx={p.x} cy={p.y} r={3} fill={COLOR} />);
  }

  return (
    <>
      <svg className="absolute inset-0 w-full h-full pointer-events-none z-[5]">{shapes}</svg>
      {tool && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 bg-[rgba(10,10,10,0.85)] border border-[var(--amber-dim)] px-2 py-0.5 text-[11px] amber pointer-events-none">
          {t(DRAW_TOOLS.find((x) => x.id === tool)!.label)}
          {pending ? ` — ${t("now click the second point")}` : ""} · Esc
        </div>
      )}
    </>
  );
}

const EMPTY: Drawing[] = [];

function toScreenWith(chart: IChartApi, series: ISeriesApi<SeriesType>, candles: Candle[], p: DrawingPoint) {
  const x = chart.timeScale().logicalToCoordinate(timeToLogical(candles, p.time) as never);
  const y = series.priceToCoordinate(p.price);
  return x === null || y === null ? null : { x, y };
}
