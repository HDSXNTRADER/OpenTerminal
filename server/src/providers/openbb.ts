import type { Candle, Quote } from "./yahoo.js";
import { intradayLookbackDays, lastSession, pickBase, resample, type Interval } from "../timeframe.js";

// OpenBB (Open Data Platform, https://github.com/OpenBB-finance/OpenBB) runs
// as a separate Python service (`pip install openbb && openbb-api`) exposing a
// REST API over dozens of data vendors. It's optional: with OPENBB_URL unset
// every function here throws and the routes fall back to the keyless public
// providers exactly as before. With it set, OpenBB is tried first — so adding
// a paid vendor key to OpenBB (FMP, Polygon, Intrinio...) upgrades the whole
// terminal without touching this code. OPENBB_PROVIDER picks which installed
// OpenBB vendor extension answers (default yfinance, bundled with openbb).

const BASE = process.env.OPENBB_URL?.trim().replace(/\/+$/, "") ?? "";
const PROVIDER = process.env.OPENBB_PROVIDER?.trim() || "yfinance";
const TIMEOUT_MS = 15_000;
// Fundamentals hit several Yahoo endpoints behind OpenBB and can take a while.
const SLOW_TIMEOUT_MS = 60_000;
// openbb-api answers roughly one call at a time, so the widgets' polling used
// to pile up requests until everything timed out. Cap what we keep in flight
// and let the free providers answer the overflow instead.
const MAX_IN_FLIGHT = 4;
let inFlight = 0;

export function enabled(): boolean {
  return BASE.length > 0;
}

export function config(): { enabled: boolean; provider: string | null } {
  return { enabled: enabled(), provider: enabled() ? PROVIDER : null };
}

function n(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/** OpenBB reports percentages normalized (0.0123 = 1.23%); the terminal uses whole percents. */
function pct(v: unknown): number | null {
  const x = n(v);
  return x === null ? null : x * 100;
}

/**
 * GET an OpenBB v5 route (e.g. /api/v1/equity/price/quote?provider=yfinance; needs openbb-equity)
 * and unwrap its OBBject envelope to the `results` array.
 */
async function obb(route: string, params: Record<string, string | number>, slow = false): Promise<any[]> {
  if (!enabled()) throw new Error("openbb: OPENBB_URL not configured");
  if (!slow && inFlight >= MAX_IN_FLIGHT) throw new Error("openbb: busy");
  inFlight++;
  try {
    return await obbFetch(route, params, slow ? SLOW_TIMEOUT_MS : TIMEOUT_MS);
  } finally {
    inFlight--;
  }
}

async function obbFetch(route: string, params: Record<string, string | number>, timeoutMs: number): Promise<any[]> {
  const qs = new URLSearchParams([["provider", PROVIDER], ...Object.entries(params).map(([k, v]) => [k, String(v)])]);
  const headers: Record<string, string> = { Accept: "application/json" };
  // openbb-api supports HTTP basic auth (OPENBB_API_USERNAME/PASSWORD on its side).
  const user = process.env.OPENBB_USERNAME;
  if (user) {
    const pass = process.env.OPENBB_PASSWORD ?? "";
    headers.Authorization = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }
  const res = await fetch(`${BASE}/api/v1/${route}?${qs}`, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body: any = await res.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail.split("\n")[0].slice(0, 200) : "";
    throw new Error(`openbb ${res.status} ${route}${detail ? `: ${detail}` : ""}`);
  }
  const json: any = await res.json();
  const results = Array.isArray(json?.results) ? json.results : json?.results ? [json.results] : [];
  if (results.length === 0) throw new Error(`openbb: no results for ${route}`);
  return results;
}

const NY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * Parse an OpenBB timestamp to epoch ms. yfinance returns exchange-local New
 * York wall time with no offset, which Date.parse would read as machine-local
 * time, so offset-less stamps are interpreted in America/New_York (DST-aware).
 */
export function parseTimestamp(raw: string): number {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(raw)) return Date.parse(raw);
  const asUtc = Date.parse(raw + "Z");
  if (!isFinite(asUtc)) return NaN;
  const p = Object.fromEntries(NY_PARTS.formatToParts(new Date(asUtc)).map((x) => [x.type, x.value]));
  const nyAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - (nyAsUtc - asUtc);
}

// ---- quotes ----

function toQuote(r: any): Quote {
  const price = n(r.last_price) ?? n(r.close);
  const previousClose = n(r.prev_close);
  const change = n(r.change) ?? (price !== null && previousClose !== null ? price - previousClose : null);
  const changePercent =
    pct(r.change_percent) ?? (change !== null && previousClose ? (change / previousClose) * 100 : null);
  return {
    symbol: String(r.symbol).toUpperCase(),
    name: r.name ?? null,
    price,
    change,
    changePercent,
    open: n(r.open),
    high: n(r.high),
    low: n(r.low),
    previousClose,
    bid: n(r.bid),
    ask: n(r.ask),
    volume: n(r.volume),
    avgVolume: n(r.volume_average),
    marketCap: n(r.market_cap),
    pe: n(r.pe_ratio),
    eps: n(r.eps_ttm),
    dividendYield: n(r.dividend_yield),
    week52High: n(r.year_high),
    week52Low: n(r.year_low),
    beta: n(r.beta),
    sharesOutstanding: n(r.shares_outstanding),
    currency: r.currency ?? null,
    exchange: r.exchange ?? null,
    marketState: null,
    time: r.last_timestamp ? Math.floor(parseTimestamp(String(r.last_timestamp)) / 1000) || null : null,
    source: `openbb:${PROVIDER}`,
  };
}

/** Batched quotes; symbols OpenBB can't resolve are simply absent from the result. */
export async function quotes(symbols: string[]): Promise<Quote[]> {
  const rows = await obb("equity/price/quote", { symbol: symbols.join(",") });
  return rows.map(toQuote).filter((q) => q.price !== null);
}

// ---- history ----

const DAY = 86_400_000;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Map the terminal's range keys to an OpenBB start date + bar interval. */
export function rangeParams(rangeKey: string, now = Date.now()): { start_date: string; interval: string } {
  const year = new Date(now).getUTCFullYear();
  const map: Record<string, { start: number; interval: string }> = {
    // 1D asks for a few days back so weekends/holidays still return the last session.
    "1D": { start: now - 5 * DAY, interval: "5m" },
    "5D": { start: now - 8 * DAY, interval: "15m" },
    "1M": { start: now - 31 * DAY, interval: "1h" },
    "6M": { start: now - 183 * DAY, interval: "1d" },
    YTD: { start: Date.UTC(year, 0, 1), interval: "1d" },
    "1Y": { start: now - 366 * DAY, interval: "1d" },
    "5Y": { start: now - 5 * 366 * DAY, interval: "1W" },
    MAX: { start: Date.UTC(1970, 0, 1), interval: "1M" },
  };
  const m = map[rangeKey] ?? map["6M"];
  return { start_date: isoDate(m.start), interval: m.interval };
}

export async function history(symbol: string, rangeKey: string): Promise<Candle[]> {
  const rows = await obb("equity/price/historical", { symbol, ...rangeParams(rangeKey) });
  let candles = toCandles(rows);
  if (rangeKey === "1D") candles = lastSession(candles);
  if (candles.length === 0) throw new Error("openbb: empty history for " + symbol);
  return candles;
}

/** Native bar sizes of the yfinance provider behind OpenBB, plus how far back intraday bars go. */
const OBB_NATIVE = {
  minutes: [[1, "1m"], [2, "2m"], [5, "5m"], [15, "15m"], [30, "30m"], [60, "1h"]] as Array<[number, string]>,
  day: "1d",
  week: "1W",
  month: "1M",
};

/** History at any timeframe: fetches the closest native bar size and resamples. */
export async function historyInterval(symbol: string, startMs: number, iv: Interval, now = Date.now()): Promise<Candle[]> {
  const { base, baseMinutes } = pickBase(iv, OBB_NATIVE);
  const start = Math.max(startMs, now - intradayLookbackDays(baseMinutes) * DAY);
  const rows = await obb("equity/price/historical", { symbol, start_date: isoDate(start), interval: base });
  const candles = resample(toCandles(rows), iv);
  if (candles.length === 0) throw new Error("openbb: empty history for " + symbol);
  return candles;
}

function toCandles(rows: any[]): Candle[] {
  const candles: Candle[] = [];
  for (const r of rows) {
    // Daily bars come back as "YYYY-MM-DD", intraday as an ISO timestamp (New York time if offset-less).
    const raw = String(r.date ?? "");
    const t = (raw.length === 10 ? Date.parse(raw + "T00:00:00Z") : parseTimestamp(raw)) / 1000;
    const close = n(r.close);
    if (!isFinite(t) || close === null) continue;
    candles.push({
      time: Math.floor(t),
      open: n(r.open) ?? close,
      high: n(r.high) ?? close,
      low: n(r.low) ?? close,
      close,
      volume: n(r.volume) ?? 0,
    });
  }
  return candles.sort((a, b) => a.time - b.time);
}

// ---- fundamentals (key metrics + company profile) ----

export type Fundamentals = {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  employees: number | null;
  website: string | null;
  currency: string | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  valuation: {
    pe: number | null;
    forwardPe: number | null;
    peg: number | null;
    priceToBook: number | null;
    evToEbitda: number | null;
    evToRevenue: number | null;
  };
  profitability: {
    grossMargin: number | null;
    operatingMargin: number | null;
    profitMargin: number | null;
    returnOnEquity: number | null;
    returnOnAssets: number | null;
  };
  growth: {
    revenueGrowth: number | null;
    earningsGrowth: number | null;
    earningsGrowthQuarterly: number | null;
  };
  health: {
    currentRatio: number | null;
    quickRatio: number | null;
    debtToEquity: number | null;
  };
  perShare: {
    epsTtm: number | null;
    epsForward: number | null;
    bookValue: number | null;
    revenuePerShare: number | null;
    cashPerShare: number | null;
  };
  dividends: {
    dividendYield: number | null;
    payoutRatio: number | null;
  };
  risk: {
    beta: number | null;
    priceReturn1y: number | null;
  };
  source: string;
};

export async function fundamentals(symbol: string): Promise<Fundamentals> {
  // Metrics are the core; the profile only adds descriptive fields, so its
  // failure (some vendors don't serve one) shouldn't sink the whole panel.
  const [metricsRows, profileRows] = await Promise.all([
    obb("equity/fundamental/metrics", { symbol }, true),
    obb("equity/profile", { symbol }, true).catch(() => [] as any[]),
  ]);
  const m = metricsRows[0] ?? {};
  const p = profileRows[0] ?? {};
  return {
    symbol: symbol.toUpperCase(),
    name: p.name ?? null,
    sector: p.sector ?? null,
    industry: p.industry_category ?? null,
    description: p.long_description ?? p.short_description ?? null,
    employees: n(p.employees),
    website: p.company_url ?? null,
    currency: m.currency ?? p.currency ?? null,
    marketCap: n(m.market_cap) ?? n(p.market_cap),
    enterpriseValue: n(m.enterprise_value),
    valuation: {
      pe: n(m.pe_ratio),
      forwardPe: n(m.forward_pe),
      peg: n(m.peg_ratio_ttm) ?? n(m.peg_ratio),
      priceToBook: n(m.price_to_book),
      evToEbitda: n(m.enterprise_to_ebitda),
      evToRevenue: n(m.enterprise_to_revenue),
    },
    profitability: {
      grossMargin: pct(m.gross_margin),
      operatingMargin: pct(m.operating_margin),
      profitMargin: pct(m.profit_margin),
      returnOnEquity: pct(m.return_on_equity),
      returnOnAssets: pct(m.return_on_assets),
    },
    growth: {
      revenueGrowth: pct(m.revenue_growth),
      earningsGrowth: pct(m.earnings_growth),
      earningsGrowthQuarterly: pct(m.earnings_growth_quarterly),
    },
    health: {
      currentRatio: n(m.current_ratio),
      quickRatio: n(m.quick_ratio),
      debtToEquity: n(m.debt_to_equity),
    },
    perShare: {
      epsTtm: n(m.eps_ttm),
      epsForward: n(m.eps_forward),
      bookValue: n(m.book_value),
      revenuePerShare: n(m.revenue_per_share),
      cashPerShare: n(m.cash_per_share),
    },
    dividends: {
      dividendYield: pct(m.dividend_yield) ?? pct(p.dividend_yield),
      payoutRatio: pct(m.payout_ratio),
    },
    risk: {
      beta: n(m.beta) ?? n(p.beta),
      priceReturn1y: pct(m.price_return_1y),
    },
    source: `openbb:${PROVIDER}`,
  };
}
