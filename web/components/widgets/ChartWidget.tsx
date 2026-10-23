"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  AreaSeries,
  BarSeries,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { apiGet, fmt, fmtBig, type Candle } from "../../lib/api";
import { sma, ema, vwap, rsi, macd, bollinger, type Point } from "../../lib/indicators";
import { useTerminal, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";

const RANGES = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
// "AUTO" lets the server pick a bar size that suits the range (the original behaviour).
const INTERVALS = ["AUTO", "30s", "1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W", "1M"] as const;
const RANGE_DAYS: Record<Range, number> = {
  "1D": 1, "5D": 5, "1M": 31, "3M": 92, "6M": 183, YTD: 366, "1Y": 366, "5Y": 1830, MAX: 20_000,
};
const UNIT_MINUTES: Record<string, number> = { s: 1 / 60, m: 1, h: 60, D: 1440, W: 10_080, M: 43_200 };

/** Bar length in minutes for "30s", "15m", "4h", "1D", "2W", "1M"... or null if not a valid timeframe. */
function intervalMinutes(iv: string): number | null {
  const m = /^(\d{1,4})(s|m|h|D|W|M)$/.exec(iv);
  return m && Number(m[1]) > 0 ? Number(m[1]) * UNIT_MINUTES[m[2]] : null;
}

/** Normalise user input like "45 min", "2H", "3d" to the server's format. */
function normalizeInterval(raw: string): string | null {
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
function rangeAllowed(range: Range, interval: string): boolean {
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
const CHART_TYPES = ["candles", "bars", "line", "area"] as const;
const INDICATORS = ["SMA20", "SMA50", "SMA200", "EMA20", "VWAP", "BOLL", "RSI", "MACD"] as const;

type Range = (typeof RANGES)[number];
type ChartType = (typeof CHART_TYPES)[number];
type Indicator = (typeof INDICATORS)[number];

const ts = (t: number) => t as UTCTimestamp;
const toMap = (pts: Point[]) => new Map(pts.map((p) => [p.time, p.value]));

const INDICATOR_COLOR: Record<string, string> = {
  SMA20: "#ffd966", SMA50: "#4fc3f7", SMA200: "#ba68c8", EMA20: "#ff8a65",
  VWAP: "#80cbc4", RSI: "#ff9900", BOLL: "#ff9900", MACD: "#4fc3f7",
};

type ChartSettings = { range?: Range; interval?: string; chartType?: ChartType; indicators?: Indicator[] };

export default function ChartWidget({ widget }: { widget: WidgetInstance }) {
  const symbol = useWidgetSymbol(widget);
  const setWidgetSettings = useTerminal((s) => s.setWidgetSettings);
  // Timeframe, chart type and indicators are saved with the widget, so they survive reloads.
  const saved = (widget.settings ?? {}) as ChartSettings;
  const range: Range = saved.range && RANGES.includes(saved.range) ? saved.range : "6M";
  const interval = saved.interval ?? "AUTO";
  const chartType: ChartType = saved.chartType ?? "candles";
  const active = useMemo(() => new Set<Indicator>(saved.indicators ?? ["SMA20"]), [saved.indicators]);
  const save = (patch: ChartSettings) => setWidgetSettings(widget.id, patch);
  const setRange = (r: Range) => save({ range: r });
  const setChartType = (t: ChartType) => save({ chartType: t });
  const setInterval_ = (iv: string) => {
    // Jump to the longest range that still works for the new bar size.
    const ok = rangeAllowed(range, iv) ? range : [...RANGES].reverse().find((r) => rangeAllowed(r, iv)) ?? "1D";
    save({ interval: iv, range: ok });
  };
  const [customDraft, setCustomDraft] = useState("");
  const [customError, setCustomError] = useState(false);
  const mins = intervalMinutes(interval);
  const intraday = interval === "AUTO" ? range === "1D" || range === "5D" : mins !== null && mins < 1440;
  const [legend, setLegend] = useState<Candle | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const { data: candles, error } = useQuery({
    queryKey: ["history", symbol, range, interval],
    queryFn: () =>
      apiGet<Candle[]>(
        `/api/history/${encodeURIComponent(symbol)}?range=${range}` +
          (interval === "AUTO" ? "" : `&interval=${encodeURIComponent(interval)}`)
      ),
    refetchInterval:
      interval === "AUTO" ? (range === "1D" ? 8_000 : 60_000) : mins !== null && mins <= 5 ? 8_000 : mins !== null && mins < 1440 ? 30_000 : 60_000,
  });

  // Fast time -> candle lookup for the crosshair legend, independent of chart type.
  const byTime = useMemo(() => {
    const m = new Map<number, Candle>();
    for (const c of candles ?? []) m.set(c.time, c);
    return m;
  }, [candles]);

  // Computed once per candles/active change, shared by both the chart overlays
  // below and the hover legend — avoids recomputing the same series twice.
  const indicatorData = useMemo(() => {
    if (!candles || candles.length === 0) return null;
    return {
      SMA20: active.has("SMA20") ? sma(candles, 20) : null,
      SMA50: active.has("SMA50") ? sma(candles, 50) : null,
      SMA200: active.has("SMA200") ? sma(candles, 200) : null,
      EMA20: active.has("EMA20") ? ema(candles, 20) : null,
      VWAP: active.has("VWAP") ? vwap(candles) : null,
      RSI: active.has("RSI") ? rsi(candles) : null,
      BOLL: active.has("BOLL") ? bollinger(candles) : null,
      MACD: active.has("MACD") ? macd(candles) : null,
    };
  }, [candles, active]);

  const indicatorMaps = useMemo(() => {
    const maps: Record<string, Map<number, number>> = {};
    if (!indicatorData) return maps;
    if (indicatorData.SMA20) maps.SMA20 = toMap(indicatorData.SMA20);
    if (indicatorData.SMA50) maps.SMA50 = toMap(indicatorData.SMA50);
    if (indicatorData.SMA200) maps.SMA200 = toMap(indicatorData.SMA200);
    if (indicatorData.EMA20) maps.EMA20 = toMap(indicatorData.EMA20);
    if (indicatorData.VWAP) maps.VWAP = toMap(indicatorData.VWAP);
    if (indicatorData.RSI) maps.RSI = toMap(indicatorData.RSI);
    if (indicatorData.BOLL) {
      maps.BOLL_U = toMap(indicatorData.BOLL.upper);
      maps.BOLL_M = toMap(indicatorData.BOLL.middle);
      maps.BOLL_L = toMap(indicatorData.BOLL.lower);
    }
    if (indicatorData.MACD) {
      maps.MACD_M = toMap(indicatorData.MACD.macd);
      maps.MACD_S = toMap(indicatorData.MACD.signal);
      maps.MACD_H = toMap(indicatorData.MACD.histogram);
    }
    return maps;
  }, [indicatorData]);

  const indicatorRows = useMemo(() => {
    if (!legend) return [];
    const t = legend.time;
    const get = (key: string) => indicatorMaps[key]?.get(t);
    const rows: Array<{ label: string; value: string; color: string }> = [];
    for (const key of ["SMA20", "SMA50", "SMA200", "EMA20", "VWAP"] as const) {
      const v = get(key);
      if (v !== undefined) rows.push({ label: key, value: fmt(v), color: INDICATOR_COLOR[key] });
    }
    const rsiV = get("RSI");
    if (rsiV !== undefined) rows.push({ label: "RSI", value: fmt(rsiV, 1), color: INDICATOR_COLOR.RSI });
    const bollM = get("BOLL_M");
    if (bollM !== undefined) {
      rows.push({
        label: "BOLL",
        value: `${fmt(get("BOLL_U"))} / ${fmt(bollM)} / ${fmt(get("BOLL_L"))}`,
        color: INDICATOR_COLOR.BOLL,
      });
    }
    const macdM = get("MACD_M");
    if (macdM !== undefined) {
      rows.push({
        label: "MACD",
        value: `${fmt(macdM, 2)} / ${fmt(get("MACD_S"), 2)} / ${fmt(get("MACD_H"), 2)}`,
        color: INDICATOR_COLOR.MACD,
      });
    }
    return rows;
  }, [legend, indicatorMaps]);

  useEffect(() => {
    setLegend(candles && candles.length > 0 ? candles[candles.length - 1] : null);
  }, [candles]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !candles || candles.length === 0) return;

    const chart = createChart(el, {
      layout: { background: { color: "#0a0a0a" }, textColor: "#808080", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: "#1a1a1a" }, horzLines: { color: "#1a1a1a" } },
      crosshair: { mode: 0 },
      timeScale: { borderColor: "#262626", timeVisible: intraday, secondsVisible: mins !== null && mins < 1 },
      rightPriceScale: { borderColor: "#262626" },
      autoSize: true,
      // Mouse-wheel is left free for page scrolling — zoom via drag, pinch, or the range buttons instead.
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    chartRef.current = chart;

    const upColor = "#00c853";
    const downColor = "#ff3d3d";

    if (chartType === "candles") {
      chart
        .addSeries(CandlestickSeries, {
          upColor, downColor, borderUpColor: upColor, borderDownColor: downColor,
          wickUpColor: upColor, wickDownColor: downColor,
        })
        .setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (chartType === "bars") {
      chart
        .addSeries(BarSeries, { upColor, downColor })
        .setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (chartType === "line") {
      chart
        .addSeries(LineSeries, { color: "#ff9900", lineWidth: 1 })
        .setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
    } else {
      chart
        .addSeries(AreaSeries, { lineColor: "#ff9900", topColor: "rgba(255,153,0,0.25)", bottomColor: "rgba(255,153,0,0)" })
        .setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
    }

    // volume histogram on its own scale at the bottom of the main pane
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" } });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    vol.setData(
      candles.map((c) => ({ time: ts(c.time), value: c.volume, color: c.close >= c.open ? "rgba(0,200,83,0.4)" : "rgba(255,61,61,0.4)" }))
    );

    const overlay = (points: Point[], color: string) =>
      chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(points.map((p) => ({ time: ts(p.time), value: p.value })));

    if (indicatorData?.SMA20) overlay(indicatorData.SMA20, INDICATOR_COLOR.SMA20);
    if (indicatorData?.SMA50) overlay(indicatorData.SMA50, INDICATOR_COLOR.SMA50);
    if (indicatorData?.SMA200) overlay(indicatorData.SMA200, INDICATOR_COLOR.SMA200);
    if (indicatorData?.EMA20) overlay(indicatorData.EMA20, INDICATOR_COLOR.EMA20);
    if (indicatorData?.VWAP) overlay(indicatorData.VWAP, INDICATOR_COLOR.VWAP);
    if (indicatorData?.BOLL) {
      overlay(indicatorData.BOLL.upper, "rgba(255,153,0,0.5)");
      overlay(indicatorData.BOLL.middle, "rgba(255,153,0,0.8)");
      overlay(indicatorData.BOLL.lower, "rgba(255,153,0,0.5)");
    }

    let paneIdx = 1;
    if (indicatorData?.RSI) {
      const s = chart.addSeries(LineSeries, { color: INDICATOR_COLOR.RSI, lineWidth: 1 }, paneIdx++);
      s.setData(indicatorData.RSI.map((p) => ({ time: ts(p.time), value: p.value })));
    }
    if (indicatorData?.MACD) {
      const m = indicatorData.MACD;
      const pane = paneIdx++;
      chart.addSeries(HistogramSeries, { color: "#4fc3f7" }, pane).setData(
        m.histogram.map((p) => ({ time: ts(p.time), value: p.value, color: p.value >= 0 ? "rgba(0,200,83,0.6)" : "rgba(255,61,61,0.6)" }))
      );
      chart.addSeries(LineSeries, { color: "#ff9900", lineWidth: 1 }, pane).setData(
        m.macd.map((p) => ({ time: ts(p.time), value: p.value }))
      );
      chart.addSeries(LineSeries, { color: "#ffffff", lineWidth: 1 }, pane).setData(
        m.signal.map((p) => ({ time: ts(p.time), value: p.value }))
      );
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setLegend(candles[candles.length - 1]);
        return;
      }
      const hit = byTime.get(param.time as number);
      if (hit) setLegend(hit);
    });

    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, chartType, indicatorData, intraday, mins, byTime]);

  const toggleIndicator = (ind: Indicator) => {
    const next = new Set(active);
    if (next.has(ind)) next.delete(ind);
    else next.add(ind);
    save({ indicators: INDICATORS.filter((i) => next.has(i)) });
  };

  const applyCustom = () => {
    const iv = normalizeInterval(customDraft);
    if (!iv) {
      setCustomError(true);
      return;
    }
    setCustomError(false);
    setCustomDraft("");
    setInterval_(iv);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 flex-wrap shrink-0">
        <span className="dim self-center text-[10px]" title="Timeframe: how long each candle lasts">TF</span>
        {INTERVALS.map((iv) => (
          <button
            key={iv}
            className={`term-btn ${interval === iv ? "active" : ""}`}
            title={iv === "AUTO" ? "Bar size picked automatically for the range" : iv === "30s" ? "30-second bars (crypto only)" : `${iv} bars`}
            onClick={() => setInterval_(iv)}
          >
            {iv}
          </button>
        ))}
        {!(INTERVALS as readonly string[]).includes(interval) && <button className="term-btn active">{interval}</button>}
        <input
          value={customDraft}
          onChange={(e) => {
            setCustomDraft(e.target.value);
            setCustomError(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && applyCustom()}
          onBlur={() => customDraft && applyCustom()}
          placeholder="custom: 3m, 2h, 3D"
          title="Any timeframe: a number plus s, m, h, D, W or M (e.g. 10s, 3m, 45m, 2h, 3D, 2W, 3M). Press Enter."
          className={`w-[92px] bg-[var(--panel-2)] border px-1 text-[11px] ${customError ? "border-[var(--down)]" : "border-[var(--border)]"}`}
        />
        <span className="w-2" />
        <span className="dim self-center text-[10px]" title="How much history to show">RANGE</span>
        {RANGES.map((r) => {
          const ok = rangeAllowed(r, interval);
          return (
            <button
              key={r}
              className={`term-btn ${range === r ? "active" : ""} ${ok ? "" : "opacity-30"}`}
              disabled={!ok}
              title={ok ? undefined : `Not available with ${interval} bars`}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          );
        })}
        <span className="w-2" />
        {CHART_TYPES.map((t) => (
          <button key={t} className={`term-btn ${chartType === t ? "active" : ""}`} onClick={() => setChartType(t)}>
            {t.toUpperCase()}
          </button>
        ))}
        <span className="w-2" />
        {INDICATORS.map((ind) => (
          <button key={ind} className={`term-btn ${active.has(ind) ? "active" : ""}`} onClick={() => toggleIndicator(ind)}>
            {ind}
          </button>
        ))}
      </div>
      {error && <div className="p-2 down">Error: {(error as Error).message}</div>}
      <div className="relative flex-1 min-h-0">
        {legend && (
          <div className="absolute top-1 left-2 z-10 flex flex-col gap-0.5 text-[11px] pointer-events-none bg-[rgba(10,10,10,0.7)] px-2 py-1 rounded max-w-[95%]">
            <div className="flex gap-3">
              <span className="dim">O <span className="text-[var(--text)]">{fmt(legend.open)}</span></span>
              <span className="dim">H <span className="up">{fmt(legend.high)}</span></span>
              <span className="dim">L <span className="down">{fmt(legend.low)}</span></span>
              <span className="dim">C <span className={legend.close >= legend.open ? "up" : "down"}>{fmt(legend.close)}</span></span>
              <span className="dim">Vol <span className="text-[var(--text)]">{fmtBig(legend.volume)}</span></span>
            </div>
            {indicatorRows.length > 0 && (
              <div className="flex gap-3 flex-wrap">
                {indicatorRows.map((r) => (
                  <span key={r.label} className="dim">
                    {r.label} <span style={{ color: r.color }}>{r.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
