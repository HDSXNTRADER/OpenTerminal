"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizeSymbol } from "../lib/symbol";

export type Lang = "pt" | "en" | "es";

export type WidgetType =
  | "quote"
  | "chart"
  | "watchlist"
  | "news"
  | "heatmap"
  | "screener"
  | "crypto"
  | "macro"
  | "options"
  | "portfolio"
  | "ai"
  | "calendar"
  | "insider"
  | "fundamentals"
  | "tv"
  | "recap"
  | "alerts"
  | "multichart";

export type WidgetInstance = {
  id: string;
  type: WidgetType;
  symbol?: string;
  linked: boolean; // follows the globally active symbol
  /** Per-widget preferences (e.g. chart timeframe), saved with the workspace. */
  settings?: Record<string, unknown>;
};

export type LayoutItem = { i: string; x: number; y: number; w: number; h: number };

/** A saved page of widgets ("Day trade", "Swing"...). The active one lives in `widgets`/`layout`. */
export type Workspace = { id: string; name: string; widgets: WidgetInstance[]; layout: LayoutItem[] };

/** A chart drawing anchored to bar times and prices, so it survives timeframe changes. */
export type DrawingPoint = { time: number; price: number };
export type Drawing =
  | { id: string; kind: "trend"; a: DrawingPoint; b: DrawingPoint }
  | { id: string; kind: "fib"; a: DrawingPoint; b: DrawingPoint }
  | { id: string; kind: "hline"; price: number };

export type PriceAlert = {
  id: string;
  symbol: string;
  price: number;
  /** Fires when the price goes above / below `price`. */
  direction: "above" | "below";
  triggeredAt: number | null;
};

type TerminalState = {
  activeSymbol: string;
  /** UI language; Portuguese by default. */
  lang: Lang;
  setLang: (lang: Lang) => void;
  widgets: WidgetInstance[];
  layout: LayoutItem[];
  watchlist: string[];
  commandOpen: boolean;
  setActiveSymbol: (s: string) => void;
  setCommandOpen: (open: boolean) => void;
  addWidget: (type: WidgetType, symbol?: string) => void;
  removeWidget: (id: string) => void;
  setWidgetSymbol: (id: string, symbol: string) => void;
  toggleLinked: (id: string) => void;
  setWidgetSettings: (id: string, patch: Record<string, unknown>) => void;
  setLayout: (layout: LayoutItem[]) => void;
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;
  resetWorkspace: () => void;
  /** Widget shown full screen, or null. Not saved. */
  maximized: string | null;
  setMaximized: (id: string | null) => void;
  workspaces: Workspace[];
  activeWorkspace: string;
  addWorkspace: (name: string) => void;
  switchWorkspace: (id: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  drawings: Record<string, Drawing[]>;
  addDrawing: (symbol: string, d: Drawing) => void;
  removeDrawing: (symbol: string, id: string) => void;
  clearDrawings: (symbol: string) => void;
  alerts: PriceAlert[];
  addAlert: (symbol: string, price: number, direction: PriceAlert["direction"]) => void;
  removeAlert: (id: string) => void;
  triggerAlert: (id: string) => void;
};

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const DEFAULT_WIDGETS: WidgetInstance[] = [
  { id: "w-chart", type: "chart", linked: true },
  { id: "w-quote", type: "quote", linked: true },
  { id: "w-watchlist", type: "watchlist", linked: false },
  { id: "w-news", type: "news", linked: true },
  { id: "w-macro", type: "macro", linked: false },
];

/**
 * Grid geometry. A fine grid (48 columns, 10px rows) lets widgets be placed
 * and sized almost freely while still lining up neatly.
 */
export const GRID = { cols: 48, rowHeight: 10, margin: 4 } as const;

// Layouts were first stored on a 12-column grid with 30px rows. These scale
// a v0 layout item to the current grid so saved workspaces keep their look.
const V0_COL = GRID.cols / 12;
const V0_ROW = (30 + 4) / (GRID.rowHeight + GRID.margin);
const fromV0 = <T extends { x: number; y: number; w: number; h: number }>(l: T): T => ({
  ...l,
  x: Math.round(l.x * V0_COL),
  w: Math.round(l.w * V0_COL),
  y: Math.round(l.y * V0_ROW),
  h: Math.round(l.h * V0_ROW),
});

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "w-chart", x: 0, y: 0, w: 7, h: 12 },
  { i: "w-quote", x: 7, y: 0, w: 5, h: 6 },
  { i: "w-watchlist", x: 7, y: 6, w: 5, h: 6 },
  { i: "w-news", x: 0, y: 12, w: 7, h: 7 },
  { i: "w-macro", x: 7, y: 12, w: 5, h: 7 },
].map(fromV0);

const SIZE_BY_TYPE: Record<WidgetType, { w: number; h: number }> = {
  quote: { w: 5, h: 6 },
  chart: { w: 7, h: 12 },
  watchlist: { w: 4, h: 7 },
  news: { w: 5, h: 8 },
  heatmap: { w: 7, h: 10 },
  screener: { w: 12, h: 9 },
  crypto: { w: 6, h: 9 },
  macro: { w: 5, h: 7 },
  options: { w: 12, h: 9 },
  portfolio: { w: 7, h: 8 },
  ai: { w: 5, h: 10 },
  calendar: { w: 12, h: 11 },
  insider: { w: 7, h: 9 },
  fundamentals: { w: 5, h: 13 },
  tv: { w: 6, h: 11 },
  recap: { w: 5, h: 12 },
  alerts: { w: 4, h: 8 },
  multichart: { w: 12, h: 16 },
};

export const useTerminal = create<TerminalState>()(
  persist(
    (set, get) => ({
      activeSymbol: "AAPL",
      lang: "pt",
      setLang: (lang) => set({ lang }),
      widgets: DEFAULT_WIDGETS,
      layout: DEFAULT_LAYOUT,
      watchlist: ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "SPY"],
      commandOpen: false,
      setActiveSymbol: (s) => {
        const sym = normalizeSymbol(s);
        if (sym) set({ activeSymbol: sym });
      },
      setCommandOpen: (open) => set({ commandOpen: open }),
      addWidget: (type, symbol) =>
        set((st) => {
          const id = uid(`w-${type}`);
          const { w, h } = fromV0({ x: 0, y: 0, ...SIZE_BY_TYPE[type] });
          const maxY = st.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
          return {
            widgets: [...st.widgets, { id, type, symbol, linked: !symbol }],
            layout: [...st.layout, { i: id, x: 0, y: maxY, w, h }],
          };
        }),
      removeWidget: (id) =>
        set((st) => ({
          widgets: st.widgets.filter((w) => w.id !== id),
          layout: st.layout.filter((l) => l.i !== id),
          maximized: st.maximized === id ? null : st.maximized,
        })),
      setWidgetSymbol: (id, symbol) => {
        const sym = normalizeSymbol(symbol);
        if (!sym) return;
        set((st) => ({
          widgets: st.widgets.map((w) => (w.id === id ? { ...w, symbol: sym, linked: false } : w)),
        }));
      },
      toggleLinked: (id) =>
        set((st) => ({
          widgets: st.widgets.map((w) => (w.id === id ? { ...w, linked: !w.linked } : w)),
        })),
      setWidgetSettings: (id, patch) =>
        set((st) => ({
          widgets: st.widgets.map((w) => (w.id === id ? { ...w, settings: { ...w.settings, ...patch } } : w)),
        })),
      setLayout: (layout) => set({ layout }),
      addToWatchlist: (s) => {
        const sym = normalizeSymbol(s);
        if (!sym) return;
        set((st) => ({
          watchlist: st.watchlist.includes(sym) ? st.watchlist : [...st.watchlist, sym],
        }));
      },
      removeFromWatchlist: (s) => set((st) => ({ watchlist: st.watchlist.filter((x) => x !== s) })),
      resetWorkspace: () => set({ widgets: DEFAULT_WIDGETS, layout: DEFAULT_LAYOUT, maximized: null }),
      maximized: null,
      setMaximized: (id) => set({ maximized: id }),
      workspaces: [{ id: "ws-main", name: "Principal", widgets: [], layout: [] }],
      activeWorkspace: "ws-main",
      addWorkspace: (name) => {
        const id = uid("ws");
        const st = get();
        set({
          workspaces: [
            ...st.workspaces.map((w) => (w.id === st.activeWorkspace ? { ...w, widgets: st.widgets, layout: st.layout } : w)),
            { id, name, widgets: DEFAULT_WIDGETS, layout: DEFAULT_LAYOUT },
          ],
          activeWorkspace: id,
          widgets: DEFAULT_WIDGETS,
          layout: DEFAULT_LAYOUT,
          maximized: null,
        });
      },
      switchWorkspace: (id) => {
        const st = get();
        const target = st.workspaces.find((w) => w.id === id);
        if (!target || id === st.activeWorkspace) return;
        set({
          workspaces: st.workspaces.map((w) => (w.id === st.activeWorkspace ? { ...w, widgets: st.widgets, layout: st.layout } : w)),
          activeWorkspace: id,
          widgets: target.widgets,
          layout: target.layout,
          maximized: null,
        });
      },
      renameWorkspace: (id, name) =>
        set((st) => ({ workspaces: st.workspaces.map((w) => (w.id === id ? { ...w, name } : w)) })),
      deleteWorkspace: (id) => {
        const st = get();
        if (st.workspaces.length <= 1) return;
        const rest = st.workspaces.filter((w) => w.id !== id);
        if (id !== st.activeWorkspace) return set({ workspaces: rest });
        set({ workspaces: rest, activeWorkspace: rest[0].id, widgets: rest[0].widgets, layout: rest[0].layout, maximized: null });
      },
      drawings: {},
      addDrawing: (symbol, d) =>
        set((st) => ({ drawings: { ...st.drawings, [symbol]: [...(st.drawings[symbol] ?? []), d] } })),
      removeDrawing: (symbol, id) =>
        set((st) => ({ drawings: { ...st.drawings, [symbol]: (st.drawings[symbol] ?? []).filter((d) => d.id !== id) } })),
      clearDrawings: (symbol) =>
        set((st) => {
          const { [symbol]: _gone, ...rest } = st.drawings;
          return { drawings: rest };
        }),
      alerts: [],
      addAlert: (symbol, price, direction) =>
        set((st) => ({ alerts: [...st.alerts, { id: uid("al"), symbol, price, direction, triggeredAt: null }] })),
      removeAlert: (id) => set((st) => ({ alerts: st.alerts.filter((a) => a.id !== id) })),
      triggerAlert: (id) =>
        set((st) => ({ alerts: st.alerts.map((a) => (a.id === id ? { ...a, triggeredAt: Date.now() } : a)) })),
    }),
    {
      name: "openterminal-workspace",
      // Transient UI state stays out of storage.
      partialize: ({ commandOpen: _c, maximized: _m, ...rest }) => rest,
      version: 1,
      migrate: (persisted, version) => {
        const st = persisted as Partial<TerminalState>;
        if (version < 1 && Array.isArray(st.layout)) st.layout = st.layout.map(fromV0);
        return st as TerminalState;
      },
    }
  )
);

/** Symbol a widget should display: its own, or the active one when linked. */
export function useWidgetSymbol(widget: WidgetInstance): string {
  const active = useTerminal((s) => s.activeSymbol);
  return widget.linked ? active : widget.symbol ?? active;
}
