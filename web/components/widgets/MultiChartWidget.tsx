"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import { apiGet, type Candle } from "../../lib/api";
import { locale, t } from "../../lib/i18n";
import { defaultRange, intervalMinutes, normalizeInterval } from "../../lib/timeframes";
import { useTerminal, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

const DEFAULT_FRAMES = ["5m", "1h", "1D", "1W"];

type Pane = { chart: IChartApi; series: ISeriesApi<SeriesType>; candles: Candle[] };

/** Last bar that starts at or before `time` (the bar that contains it), or null. */
function barAt(candles: Candle[], time: number): Candle | null {
  let lo = 0;
  let hi = candles.length - 1;
  if (hi < 0 || candles[0].time > time) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (candles[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return candles[lo];
}

/**
 * The same symbol on several timeframes side by side. Moving the crosshair
 * on one chart shows the matching moment (the bar that contains it) on the others.
 */
export default function MultiChartWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const setWidgetSettings = useTerminal((s) => s.setWidgetSettings);
  const frames = ((widget.settings?.frames as string[] | undefined) ?? DEFAULT_FRAMES).slice(0, 4);
  const panes = useRef(new Map<number, Pane>());

  const setFrame = (i: number, iv: string) => {
    const next = [...frames];
    next[i] = iv;
    setWidgetSettings(widget.id, { frames: next });
  };
  const setCount = (n: number) => {
    const next = [...frames];
    while (next.length < n) next.push(DEFAULT_FRAMES[next.length] ?? "1D");
    setWidgetSettings(widget.id, { frames: next.slice(0, n) });
  };

  const onHover = (from: number, time: number | null) => {
    panes.current.forEach((p, i) => {
      if (i === from) return;
      const bar = time === null ? null : barAt(p.candles, time);
      if (bar) p.chart.setCrosshairPosition(bar.close, bar.time as UTCTimestamp, p.series);
      else p.chart.clearCrosshairPosition();
    });
  };

  const cols = frames.length <= 2 ? frames.length : 2;
  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 items-center shrink-0">
        <span className="dim text-[10px]">{t("Charts")}</span>
        {[2, 3, 4].map((n) => (
          <button key={n} className={`term-btn ${frames.length === n ? "active" : ""}`} onClick={() => setCount(n)}>
            {n}
          </button>
        ))}
        <span className="dim text-[10px] ml-2">{t("Crosshair is synced across the charts")}</span>
      </div>
      <div
        className="flex-1 min-h-0 grid gap-1 p-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}
      >
        {frames.map((iv, i) => (
          <MiniChart
            key={i}
            index={i}
            symbol={symbol}
            interval={iv}
            onChange={(v) => setFrame(i, v)}
            register={(p) => (p ? panes.current.set(i, p) : panes.current.delete(i))}
            onHover={onHover}
          />
        ))}
      </div>
    </div>
  );
}

function MiniChart({
  index,
  symbol,
  interval,
  onChange,
  register,
  onHover,
}: {
  index: number;
  symbol: string;
  interval: string;
  onChange: (iv: string) => void;
  register: (p: Pane | null) => void;
  onHover: (from: number, time: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(interval);
  useEffect(() => setDraft(interval), [interval]);
  const mins = intervalMinutes(interval);
  const range = defaultRange(interval);

  const { data: candles, error } = useQuery({
    queryKey: ["history", symbol, range, interval],
    queryFn: () => apiGet<Candle[]>(`/api/history/${encodeURIComponent(symbol)}?range=${range}&interval=${encodeURIComponent(interval)}`),
    refetchInterval: mins !== null && mins < 1440 ? 30_000 : 120_000,
  });

  // Keep the latest hover callback without rebuilding the chart.
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;

  useEffect(() => {
    const el = ref.current;
    if (!el || !candles || candles.length === 0) return;
    const chart = createChart(el, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#808080", fontSize: 10, attributionLogo: false },
      localization: { locale: locale() },
      grid: { vertLines: { color: "#161616" }, horzLines: { color: "#161616" } },
      crosshair: { mode: 0 },
      timeScale: { borderColor: "#262626", timeVisible: mins !== null && mins < 1440, secondsVisible: mins !== null && mins < 1 },
      rightPriceScale: { borderColor: "#262626" },
      autoSize: true,
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    const up = "#00c853";
    const down = "#ff3d3d";
    const series = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
    });
    series.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    chart.timeScale().fitContent();
    register({ chart, series, candles });

    // Only the chart under the mouse drives the others; synced charts ignore their own moves.
    let hovered = false;
    const enter = () => (hovered = true);
    const leave = () => {
      hovered = false;
      hoverRef.current(index, null);
    };
    el.addEventListener("mouseenter", enter);
    el.addEventListener("mouseleave", leave);
    chart.subscribeCrosshairMove((param) => {
      if (hovered) hoverRef.current(index, param.time ? (param.time as number) : null);
    });
    return () => {
      el.removeEventListener("mouseenter", enter);
      el.removeEventListener("mouseleave", leave);
      register(null);
      chart.remove();
    };
  }, [candles]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    const iv = normalizeInterval(draft);
    if (iv && iv !== interval) onChange(iv);
    else setDraft(interval);
  };

  return (
    <div className="relative border border-[var(--border)] min-h-0 min-w-0">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === "Enter" && apply()}
        title={t("Timeframe: how long each candle lasts")}
        className="absolute top-1 left-1 z-10 w-14 bg-[rgba(10,10,10,0.8)] border border-[var(--amber-dim)] amber text-[11px] px-1"
      />
      {error && <div className="absolute top-7 left-1 z-10 down text-[11px]">{t((error as Error).message)}</div>}
      <div ref={ref} className="w-full h-full" />
    </div>
  );
}
