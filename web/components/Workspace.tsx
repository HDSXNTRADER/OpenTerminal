"use client";

import { useEffect, useRef, useState } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { normalizeSymbol } from "../lib/symbol";
import { GRID, useTerminal, type WidgetInstance } from "../store/terminal";
import QuoteWidget from "./widgets/QuoteWidget";
import ChartWidget from "./widgets/ChartWidget";
import WatchlistWidget from "./widgets/WatchlistWidget";
import NewsWidget from "./widgets/NewsWidget";
import HeatmapWidget from "./widgets/HeatmapWidget";
import ScreenerWidget from "./widgets/ScreenerWidget";
import CryptoWidget from "./widgets/CryptoWidget";
import MacroWidget from "./widgets/MacroWidget";
import OptionsWidget from "./widgets/OptionsWidget";
import PortfolioWidget from "./widgets/PortfolioWidget";
import AiWidget from "./widgets/AiWidget";
import CalendarWidget from "./widgets/CalendarWidget";
import InsiderWidget from "./widgets/InsiderWidget";
import FundamentalsWidget from "./widgets/FundamentalsWidget";
import TvWidget from "./widgets/TvWidget";
import RecapWidget from "./widgets/RecapWidget";
import AlertsWidget from "./widgets/AlertsWidget";
import MultiChartWidget from "./widgets/MultiChartWidget";
import BrazilWidget from "./widgets/BrazilWidget";
import SeasonalityWidget from "./widgets/SeasonalityWidget";
import CorrelationWidget from "./widgets/CorrelationWidget";
import ScannerWidget from "./widgets/ScannerWidget";
import BriefWidget from "./widgets/BriefWidget";
import WidgetErrorBoundary from "./WidgetErrorBoundary";
import { t } from "../lib/i18n";

const Grid = WidthProvider(GridLayout);

function WidgetBody({ widget }: { widget: WidgetInstance }) {
  switch (widget.type) {
    case "quote": return <QuoteWidget widget={widget} />;
    case "chart": return <ChartWidget widget={widget} />;
    case "watchlist": return <WatchlistWidget />;
    case "news": return <NewsWidget widget={widget} />;
    case "heatmap": return <HeatmapWidget />;
    case "screener": return <ScreenerWidget />;
    case "crypto": return <CryptoWidget />;
    case "macro": return <MacroWidget />;
    case "options": return <OptionsWidget widget={widget} />;
    case "portfolio": return <PortfolioWidget />;
    case "ai": return <AiWidget />;
    case "calendar": return <CalendarWidget />;
    case "insider": return <InsiderWidget widget={widget} />;
    case "fundamentals": return <FundamentalsWidget widget={widget} />;
    case "tv": return <TvWidget />;
    case "recap": return <RecapWidget />;
    case "alerts": return <AlertsWidget />;
    case "multichart": return <MultiChartWidget widget={widget} />;
    case "brazil": return <BrazilWidget />;
    case "seasonality": return <SeasonalityWidget widget={widget} />;
    case "correlation": return <CorrelationWidget />;
    case "scanner": return <ScannerWidget />;
    case "brief": return <BriefWidget widget={widget} />;
  }
}

function SymbolTag({ widget, activeSymbol }: { widget: WidgetInstance; activeSymbol: string }) {
  const setWidgetSymbol = useTerminal((s) => s.setWidgetSymbol);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = widget.linked ? activeSymbol : widget.symbol ?? activeSymbol;

  useEffect(() => {
    if (!editing) return;
    setDraft(shown);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = normalizeSymbol(draft);
            if (v) setWidgetSymbol(widget.id, v);
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        className="ml-2 w-16 !border-0 !border-b !border-[var(--amber-dim)] bg-transparent text-[var(--text)] px-0 py-0 text-[13px] leading-none"
      />
    );
  }

  return (
    <span
      className="ml-2 text-[var(--text)] cursor-pointer hover:text-[var(--amber)]"
      title={t("Click to set this widget's ticker")}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => setEditing(true)}
    >
      {shown}
    </span>
  );
}

const TITLES: Record<string, string> = {
  quote: "Quote", chart: "Chart", watchlist: "Watchlist", news: "News",
  heatmap: "Heatmap", screener: "Screener", crypto: "Crypto",
  macro: "Macro / Indexes", options: "Option Chain", portfolio: "Portfolio", ai: "AI Assistant",
  calendar: "Calendar", insider: "Insider Transactions", fundamentals: "Fundamentals (OpenBB)", tv: "Live TV", recap: "Market Recap",
  alerts: "Price Alerts", multichart: "Multi-Timeframe", brazil: "Brazil", seasonality: "Seasonality",
  correlation: "Correlation", scanner: "Pattern Scanner", brief: "Daily AI Brief",
};

const SYMBOL_AWARE = new Set(["quote", "chart", "news", "options", "insider", "fundamentals", "multichart", "seasonality"]);

function Panel({ widget: w }: { widget: WidgetInstance }) {
  const removeWidget = useTerminal((s) => s.removeWidget);
  const toggleLinked = useTerminal((s) => s.toggleLinked);
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const maximized = useTerminal((s) => s.maximized);
  const setMaximized = useTerminal((s) => s.setMaximized);
  const isMax = maximized === w.id;
  const toggleMax = () => setMaximized(isMax ? null : w.id);

  return (
    <div className="terminal-panel">
      {/* The grid swallows mouseup/click on the drag handle, so detect the double-click on mousedown. */}
      <div className="panel-title" onMouseDown={(e) => e.detail === 2 && toggleMax()}>
        <span>
          {t(TITLES[w.type])}
          {SYMBOL_AWARE.has(w.type) && <SymbolTag widget={w} activeSymbol={activeSymbol} />}
        </span>
        <span className="flex gap-2 items-center">
          {SYMBOL_AWARE.has(w.type) && (
            <button
              title={t(w.linked ? "Linked to active symbol (click to unlink)" : "Unlinked (click to link)")}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => toggleLinked(w.id)}
              className={w.linked ? "text-[var(--amber)]" : "dim"}
            >
              ⛓
            </button>
          )}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={toggleMax}
            title={t(isMax ? "Restore (Esc)" : "Maximize (or double-click the title)")}
            className={isMax ? "text-[var(--amber)]" : "dim hover:text-[var(--amber)]"}
          >
            {isMax ? "❐" : "⛶"}
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => removeWidget(w.id)}
            title={t("Close widget")}
            className="dim hover:text-[var(--down)]"
          >
            ✕
          </button>
        </span>
      </div>
      <div className="flex-1 overflow-auto min-h-0">
        <WidgetErrorBoundary name={t(TITLES[w.type])}>
          <WidgetBody widget={w} />
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}

export default function Workspace() {
  const widgets = useTerminal((s) => s.widgets);
  const layout = useTerminal((s) => s.layout);
  const setLayout = useTerminal((s) => s.setLayout);
  const maximized = useTerminal((s) => s.maximized);
  const setMaximized = useTerminal((s) => s.setMaximized);
  const maxWidget = widgets.find((w) => w.id === maximized);

  useEffect(() => {
    if (!maxWidget) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMaximized(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maxWidget, setMaximized]);

  // Full-screen mode shows just that widget; the grid layout is left untouched.
  if (maxWidget) {
    return (
      <div className="h-full p-1">
        <Panel widget={maxWidget} />
      </div>
    );
  }

  return (
    <Grid
      className="layout"
      layout={layout.map((l) => ({ ...l, minW: 4, minH: 4 }))}
      cols={GRID.cols}
      rowHeight={GRID.rowHeight}
      margin={[GRID.margin, GRID.margin]}
      // Free placement: widgets stay exactly where they are dropped instead of
      // floating up, and can be resized from any edge or corner.
      compactType={null}
      resizeHandles={["s", "e", "w", "n", "se", "sw", "ne", "nw"]}
      draggableHandle=".panel-title"
      draggableCancel="button, input"
      onLayoutChange={(l) => setLayout(l.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })))}
    >
      {widgets.map((w) => (
        <div key={w.id}>
          <Panel widget={w} />
        </div>
      ))}
    </Grid>
  );
}
