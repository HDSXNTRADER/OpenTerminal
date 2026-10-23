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
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import { apiGet, fmt, fmtBig, type Candle } from "../../lib/api";
import { sma, ema, vwap, rsi, macd, bollinger, type Point } from "../../lib/indicators";
import { useTerminal, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import { locale, t } from "../../lib/i18n";
import { INTERVALS, RANGES, intervalMinutes, normalizeInterval, rangeAllowed, type Range } from "../../lib/timeframes";
import DrawingLayer, { DRAW_TOOLS, type ChartApi, type DrawTool } from "./ChartDrawings";

// The chart the user last pointed at or clicked receives typed timeframe shortcuts.
let keyboardChart: string | null = null;

const CHART_TYPES = ["candles", "bars", "line", "area"] as const;
const INDICATORS = ["SMA20", "SMA50", "SMA200", "EMA20", "VWAP", "BOLL", "RSI", "MACD"] as const;

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
  const [api, setApi] = useState<ChartApi | null>(null);
  const [tool, setTool] = useState<DrawTool>(null);
  const hasDrawings = useTerminal((s) => (s.drawings[symbol]?.length ?? 0) > 0);
  const clearDrawings = useTerminal((s) => s.clearDrawings);
  const [typed, setTyped] = useState("");

  // TradingView-style shortcuts: point at a chart and type "5" Enter (5m), "1h", "4h", "1D", "1W"...
  // Esc cancels typing or the active drawing tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyboardChart !== widget.id || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === "Escape") {
        setTyped("");
        setTool(null);
        return;
      }
      if (e.key === "Enter" && typed) {
        e.preventDefault();
        const iv = normalizeInterval(/^\d+$/.test(typed) ? `${typed}m` : typed);
        if (iv) setInterval_(iv);
        setTyped("");
        return;
      }
      if (e.key === "Backspace" && typed) {
        setTyped((v) => v.slice(0, -1));
        return;
      }
      if (/^[0-9]$/.test(e.key) || (typed && /^[smhdwMSHDW]$/.test(e.key) && /^\d+$/.test(typed))) {
        e.preventDefault();
        setTyped((v) => (v + e.key).slice(0, 6));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!typed) return;
    const timer = setTimeout(() => setTyped(""), 4000);
    return () => clearTimeout(timer);
  }, [typed]);

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
      localization: { locale: locale() },
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

    let main: ISeriesApi<SeriesType>;
    if (chartType === "candles") {
      main = chart.addSeries(CandlestickSeries, {
        upColor, downColor, borderUpColor: upColor, borderDownColor: downColor,
        wickUpColor: upColor, wickDownColor: downColor,
      });
      main.setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (chartType === "bars") {
      main = chart.addSeries(BarSeries, { upColor, downColor });
      main.setData(candles.map((c) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (chartType === "line") {
      main = chart.addSeries(LineSeries, { color: "#ff9900", lineWidth: 1 });
      main.setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
    } else {
      main = chart.addSeries(AreaSeries, { lineColor: "#ff9900", topColor: "rgba(255,153,0,0.25)", bottomColor: "rgba(255,153,0,0)" });
      main.setData(candles.map((c) => ({ time: ts(c.time), value: c.close })));
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
    setApi({ chart, series: main });
    return () => {
      setApi(null);
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
    <div
      className="flex flex-col h-full"
      onMouseEnter={() => (keyboardChart = widget.id)}
      onMouseDown={() => (keyboardChart = widget.id)}
    >
      <div className="flex gap-1 p-1 flex-wrap shrink-0">
        <span className="dim self-center text-[10px]" title={t("Timeframe: how long each candle lasts")}>TF</span>
        {INTERVALS.map((iv) => (
          <button
            key={iv}
            className={`term-btn ${interval === iv ? "active" : ""}`}
            title={iv === "AUTO" ? t("Bar size picked automatically for the range") : iv === "30s" ? t("30-second bars (crypto only)") : t("{iv} bars", { iv })}
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
          placeholder={t("custom: 3m, 2h, 3D")}
          title={t("Any timeframe: a number plus s, m, h, D, W or M (e.g. 10s, 3m, 45m, 2h, 3D, 2W, 3M). Press Enter.")}
          className={`w-[92px] bg-[var(--panel-2)] border px-1 text-[11px] ${customError ? "border-[var(--down)]" : "border-[var(--border)]"}`}
        />
        <span className="w-2" />
        <span className="dim self-center text-[10px]" title={t("How much history to show")}>{t("RANGE")}</span>
        {RANGES.map((r) => {
          const ok = rangeAllowed(r, interval);
          return (
            <button
              key={r}
              className={`term-btn ${range === r ? "active" : ""} ${ok ? "" : "opacity-30"}`}
              disabled={!ok}
              title={ok ? undefined : t("Not available with {iv} bars", { iv: interval })}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          );
        })}
        <span className="w-2" />
        {CHART_TYPES.map((ct) => (
          <button key={ct} className={`term-btn ${chartType === ct ? "active" : ""}`} onClick={() => setChartType(ct)}>
            {t(ct.toUpperCase())}
          </button>
        ))}
        <span className="w-2" />
        {INDICATORS.map((ind) => (
          <button key={ind} className={`term-btn ${active.has(ind) ? "active" : ""}`} onClick={() => toggleIndicator(ind)}>
            {ind}
          </button>
        ))}
        <span className="w-2" />
        {DRAW_TOOLS.map((dt) => (
          <button
            key={dt.id}
            className={`term-btn ${tool === dt.id ? "active" : ""}`}
            title={t(dt.label)}
            onClick={() => setTool(tool === dt.id ? null : dt.id)}
          >
            {dt.icon}
          </button>
        ))}
        {(
          <button
            className={`term-btn ${hasDrawings ? "" : "opacity-30"}`}
            disabled={!hasDrawings}
            title={t("Delete all drawings on {s}", { s: symbol })}
            onClick={() => window.confirm(t("Delete all drawings on {s}", { s: symbol }) + "?") && clearDrawings(symbol)}
          >
            🗑
          </button>
        )}
      </div>
      {error && <div className="p-2 down">{t("Error")}: {t((error as Error).message)}</div>}
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
        <div ref={containerRef} className={`w-full h-full ${tool ? "cursor-crosshair" : ""}`} />
        {candles && <DrawingLayer api={api} candles={candles} symbol={symbol} tool={tool} onDone={() => setTool(null)} />}
        {typed && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 bg-[var(--panel-2)] border border-[var(--amber)] px-4 py-2 text-center pointer-events-none">
            <div className="amber text-2xl font-bold">{typed}</div>
            <div className="dim text-[10px]">{t("Enter = change timeframe · Esc = cancel")}</div>
          </div>
        )}
      </div>
    </div>
  );
}
