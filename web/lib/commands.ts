import { normalizeSymbol } from "./symbol";
import { useTerminal, type WidgetType } from "../store/terminal";

/** Bloomberg-style function codes ("mnemonics") and the widget each one opens. */
export const FUNCTIONS: Array<{ codes: string[]; type: WidgetType; desc: string; ticker?: boolean }> = [
  { codes: ["GP", "G", "CHART"], type: "chart", desc: "Price chart", ticker: true },
  { codes: ["MTF", "GIP"], type: "multichart", desc: "Several timeframes side by side", ticker: true },
  { codes: ["Q", "QUOTE"], type: "quote", desc: "Quote", ticker: true },
  { codes: ["DES"], type: "des", desc: "Company description", ticker: true },
  { codes: ["FA"], type: "financials", desc: "Financial statements", ticker: true },
  { codes: ["ANR"], type: "anr", desc: "Analyst consensus", ticker: true },
  { codes: ["RV"], type: "peers", desc: "Peer comparison", ticker: true },
  { codes: ["N", "CN", "NEWS"], type: "news", desc: "News", ticker: true },
  { codes: ["OMON", "OPT"], type: "options", desc: "Option chain", ticker: true },
  { codes: ["FUND"], type: "fundamentals", desc: "Fundamentals (OpenBB)", ticker: true },
  { codes: ["INS"], type: "insider", desc: "Insider transactions", ticker: true },
  { codes: ["SEAS"], type: "seasonality", desc: "Seasonality", ticker: true },
  { codes: ["WEI"], type: "wei", desc: "World indexes" },
  { codes: ["FXC"], type: "fx", desc: "Currency matrix" },
  { codes: ["GC"], type: "curves", desc: "Yield curves" },
  { codes: ["CMDTY", "GLCO"], type: "commodities", desc: "Commodities" },
  { codes: ["ECO"], type: "calendar", desc: "Economic calendar" },
  { codes: ["ECST", "MACRO"], type: "macro", desc: "Macro / indexes" },
  { codes: ["MOST", "EQS"], type: "screener", desc: "Stock screener" },
  { codes: ["IMAP", "HMAP"], type: "heatmap", desc: "Market heatmap" },
  { codes: ["BR"], type: "brazil", desc: "Brazil panel" },
  { codes: ["CRYPTO"], type: "crypto", desc: "Crypto" },
  { codes: ["W", "WL"], type: "watchlist", desc: "Watchlist" },
  { codes: ["PORT"], type: "portfolio", desc: "Portfolio" },
  { codes: ["ALRT"], type: "alerts", desc: "Price alerts" },
  { codes: ["CORR"], type: "correlation", desc: "Correlation" },
  { codes: ["SCAN"], type: "scanner", desc: "Pattern scanner" },
  { codes: ["RECAP"], type: "recap", desc: "Market recap" },
  { codes: ["BRIEF"], type: "brief", desc: "Daily AI brief", ticker: true },
  { codes: ["AI"], type: "ai", desc: "AI assistant" },
  { codes: ["TV"], type: "tv", desc: "Live TV" },
];

export function findFunction(code: string) {
  const c = code.toUpperCase();
  return FUNCTIONS.find((f) => f.codes.includes(c));
}

/** Widget under the mouse, for F3 (maximize). */
export const hovered: { id: string | null } = { id: null };

/** Scrolls a widget into view and makes its border blink, so the user sees where the command went. */
export function revealWidget(id: string) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-widget-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.classList.remove("widget-focus");
    void (el as HTMLElement).offsetWidth; // restart the animation
    el.classList.add("widget-focus");
  });
}

/** B3 tickers typed bare ("PETR4", "BOVA11") get Yahoo's ".SA" suffix. */
const b3 = (s: string) => (/^[A-Z]{4}\d{1,2}F?$/.test(s) ? `${s}.SA` : s);

export type CommandResult = { ok: boolean; message: string };

/**
 * Runs a command line like "PETR4.SA GP", "AAPL DES", "WEI" or just "MSFT".
 * The last word is the function code when it is one; whatever comes before it is the ticker.
 */
export function runCommand(input: string): CommandResult {
  const words = input.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { ok: false, message: "" };
  const st = useTerminal.getState();
  const last = words[words.length - 1];

  if (last === "HELP" || last === "?") {
    st.setHelpOpen(true);
    return { ok: true, message: "" };
  }

  const fn = findFunction(last);
  const tickerWords = fn ? words.slice(0, -1) : words;
  const ticker = tickerWords.length ? normalizeSymbol(b3(tickerWords.join(""))) : null;
  if (tickerWords.length && !ticker) return { ok: false, message: "Unknown ticker or function" };

  if (!fn) {
    st.setActiveSymbol(ticker!);
    return { ok: true, message: ticker! };
  }

  // Reuse the first widget of that type on this page; open one if there is none.
  let widget = st.widgets.find((w) => w.type === fn.type);
  if (!widget) {
    st.addWidget(fn.type);
    widget = useTerminal.getState().widgets.filter((w) => w.type === fn.type).pop()!;
  }
  if (ticker) {
    if (widget.group) st.setGroupSymbol(widget.group, ticker);
    else if (widget.linked || !fn.ticker) st.setActiveSymbol(ticker);
    else st.setWidgetSymbol(widget.id, ticker);
  }
  if (st.maximized && st.maximized !== widget.id) st.setMaximized(null);
  revealWidget(widget.id);
  return { ok: true, message: `${ticker ? ticker + " " : ""}${fn.codes[0]}` };
}
