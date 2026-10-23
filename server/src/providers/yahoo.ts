import { intradayLookbackDays, pickBase, resample, type Interval } from "../timeframe.js";
// A single hardcoded User-Agent makes every self-hosted install share one
// fingerprint: when the app's traffic grows, providers can throttle the whole
// fleet by blocking that one string (observed: sustained HTTP 429 from Yahoo
// for the previous fixed UA, while other realistic UAs on the same IP worked).
// So pick one UA per server process from a small pool of plausible, current,
// OS/browser-diverse strings — sticky for the process lifetime so our cookie/
// crumb session stays consistent — and let operators pin their own explicitly.
const UA_POOL = [
  "Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0",
];

function selectUserAgent(): string {
  const pinned = process.env.YAHOO_USER_AGENT?.trim();
  if (pinned) return pinned;
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

const UA = selectUserAgent();

export type Quote = {
  symbol: string;
  name: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  avgVolume: number | null;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  dividendYield: number | null;
  week52High: number | null;
  week52Low: number | null;
  beta: number | null;
  sharesOutstanding: number | null;
  currency: string | null;
  exchange: string | null;
  marketState: string | null;
  time: number | null;
  source: string;
};

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

// ---- crumb/cookie session (needed for the v7 quote and options endpoints) ----

let session: { cookie: string; crumb: string; fetched: number } | null = null;
let sessionFailedUntil = 0;

async function getSession(): Promise<{ cookie: string; crumb: string }> {
  if (session && Date.now() - session.fetched < 30 * 60 * 1000) return session;
  if (Date.now() < sessionFailedUntil) throw new Error("yahoo: crumb fetch failed (cached failure)");
  try {
    const res = await fetch("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual" });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    if (!cookie) throw new Error("yahoo: no session cookie");
    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie },
    });
    const crumb = (await crumbRes.text()).trim();
    if (!crumbRes.ok || !crumb || crumb.includes("<")) throw new Error("yahoo: crumb fetch failed");
    session = { cookie, crumb, fetched: Date.now() };
    return session;
  } catch (err) {
    sessionFailedUntil = Date.now() + 60_000;
    throw err;
  }
}

// Global politeness limiter: max 2 concurrent Yahoo requests with a minimum
// spacing between request starts, plus a cooldown window after a 429 (with
// backoff on repeat offenses) so we fail fast and let the cache serve stale data.
const MAX_CONCURRENT = 2;
const MIN_SPACING_MS = 150;
let active = 0;
let nextSlotAt = 0;
const waiters: Array<() => void> = [];
let cooldownUntil = 0;
let consecutive429s = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquire(): Promise<void> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  const wait = nextSlotAt - Date.now();
  nextSlotAt = Math.max(Date.now(), nextSlotAt) + MIN_SPACING_MS;
  if (wait > 0) await sleep(wait);
}

function release(): void {
  active--;
  waiters.shift()?.();
}

async function yfetch(url: string, withCrumb = false): Promise<any> {
  if (Date.now() < cooldownUntil) {
    throw new Error("yahoo rate-limited (cooling down)");
  }
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/json" };
  let full = url;
  await acquire();
  try {
    if (withCrumb) {
      const s = await getSession();
      headers.Cookie = s.cookie;
      full += (url.includes("?") ? "&" : "?") + "crumb=" + encodeURIComponent(s.crumb);
    }
    const res = await fetch(full, { headers });
    if (!res.ok) {
      if (res.status === 429) {
        consecutive429s++;
        cooldownUntil = Date.now() + Math.min(30_000 * consecutive429s, 5 * 60_000);
      }
      if (withCrumb && (res.status === 401 || res.status === 403)) session = null;
      throw new Error(`yahoo ${res.status} for ${url}`);
    }
    consecutive429s = 0;
    return res.json();
  } finally {
    release();
  }
}

const n = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

// ---- quotes ----

export async function quotes(symbols: string[]): Promise<Quote[]> {
  const url =
    "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + encodeURIComponent(symbols.join(","));
  const json = await yfetch(url, true);
  const rows: any[] = json?.quoteResponse?.result ?? [];
  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.longName ?? r.shortName ?? null,
    price: n(r.regularMarketPrice),
    change: n(r.regularMarketChange),
    changePercent: n(r.regularMarketChangePercent),
    open: n(r.regularMarketOpen),
    high: n(r.regularMarketDayHigh),
    low: n(r.regularMarketDayLow),
    previousClose: n(r.regularMarketPreviousClose),
    bid: n(r.bid),
    ask: n(r.ask),
    volume: n(r.regularMarketVolume),
    avgVolume: n(r.averageDailyVolume3Month),
    marketCap: n(r.marketCap),
    pe: n(r.trailingPE),
    eps: n(r.epsTrailingTwelveMonths),
    dividendYield: n(r.trailingAnnualDividendYield),
    week52High: n(r.fiftyTwoWeekHigh),
    week52Low: n(r.fiftyTwoWeekLow),
    beta: n(r.beta),
    sharesOutstanding: n(r.sharesOutstanding),
    currency: r.currency ?? null,
    exchange: r.fullExchangeName ?? r.exchange ?? null,
    marketState: r.marketState ?? null,
    time: n(r.regularMarketTime),
    source: "yahoo",
  }));
}

/** Quote fallback that works without crumb, using the chart endpoint's metadata. */
export async function quoteFromChart(symbol: string): Promise<Quote> {
  const json = await yfetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`
  );
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("yahoo chart: no meta for " + symbol);
  const price = n(meta.regularMarketPrice);
  const prev = n(meta.chartPreviousClose ?? meta.previousClose);
  return {
    symbol: meta.symbol ?? symbol,
    name: meta.longName ?? meta.shortName ?? null,
    price,
    change: price !== null && prev !== null ? price - prev : null,
    changePercent: price !== null && prev !== null && prev !== 0 ? ((price - prev) / prev) * 100 : null,
    open: null,
    high: n(meta.regularMarketDayHigh),
    low: n(meta.regularMarketDayLow),
    previousClose: prev,
    bid: null,
    ask: null,
    volume: n(meta.regularMarketVolume),
    avgVolume: null,
    marketCap: null,
    pe: null,
    eps: null,
    dividendYield: null,
    week52High: n(meta.fiftyTwoWeekHigh),
    week52Low: n(meta.fiftyTwoWeekLow),
    beta: null,
    sharesOutstanding: null,
    currency: meta.currency ?? null,
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
    marketState: null,
    time: n(meta.regularMarketTime),
    source: "yahoo-chart",
  };
}

// ---- history ----

export async function history(symbol: string, range: string, interval: string): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=${interval}&includePrePost=false`;
  const json = await yfetch(url);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("yahoo: no chart data for " + symbol);
  const ts: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const [o, h, l, c] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
  }
  return candles;
}

const YAHOO_NATIVE = {
  minutes: [[1, "1m"], [2, "2m"], [5, "5m"], [15, "15m"], [30, "30m"], [60, "60m"]] as Array<[number, string]>,
  day: "1d",
  week: "1wk",
  month: "1mo",
};

/** History at any timeframe: fetches the closest native Yahoo interval and resamples. */
export async function historyInterval(symbol: string, startMs: number, iv: Interval, now = Date.now()): Promise<Candle[]> {
  const { base, baseMinutes } = pickBase(iv, YAHOO_NATIVE);
  const start = Math.max(startMs, now - intradayLookbackDays(baseMinutes) * 86_400_000, 0);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${Math.floor(
    start / 1000
  )}&period2=${Math.floor(now / 1000)}&interval=${base}&includePrePost=false`;
  const json = await yfetch(url);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("yahoo: no chart data for " + symbol);
  const ts: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const [o, h, l, c] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
  }
  if (candles.length === 0) throw new Error("yahoo: empty history for " + symbol);
  return resample(candles, iv);
}

// ---- search ----

export type SearchResult = { symbol: string; name: string; exchange: string; type: string };

export async function search(query: string): Promise<SearchResult[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
    query
  )}&quotesCount=12&newsCount=0`;
  const json = await yfetch(url);
  return (json?.quotes ?? [])
    .filter((r: any) => r.symbol)
    .map((r: any) => ({
      symbol: r.symbol,
      name: r.longname ?? r.shortname ?? r.symbol,
      exchange: r.exchDisp ?? r.exchange ?? "",
      type: r.quoteType ?? r.typeDisp ?? "",
    }));
}

// ---- options ----

export async function options(symbol: string, date?: number): Promise<any> {
  let url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`;
  if (date) url += `?date=${date}`;
  const json = await yfetch(url, true);
  const result = json?.optionChain?.result?.[0];
  if (!result) throw new Error("yahoo: no option chain for " + symbol);
  const chain = result.options?.[0] ?? { calls: [], puts: [] };
  const pick = (o: any) => ({
    strike: n(o.strike),
    lastPrice: n(o.lastPrice),
    bid: n(o.bid),
    ask: n(o.ask),
    change: n(o.change),
    percentChange: n(o.percentChange),
    volume: n(o.volume),
    openInterest: n(o.openInterest),
    impliedVolatility: n(o.impliedVolatility),
    inTheMoney: !!o.inTheMoney,
  });
  return {
    symbol,
    underlyingPrice: n(result.quote?.regularMarketPrice),
    expirationDates: result.expirationDates ?? [],
    selectedDate: chain.expirationDate ?? null,
    calls: (chain.calls ?? []).map(pick),
    puts: (chain.puts ?? []).map(pick),
  };
}


// ---- company profile + analyst consensus (quoteSummary) ----

export type CompanyProfile = {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  employees: number | null;
  description: string | null;
  officers: Array<{ name: string; title: string | null }>;
  exchange: string | null;
  currency: string | null;
  marketCap: number | null;
  analysts: {
    recommendation: string | null;
    /** 1 = strong buy … 5 = strong sell. */
    mean: number | null;
    count: number | null;
    targetMean: number | null;
    targetHigh: number | null;
    targetLow: number | null;
    targetMedian: number | null;
    price: number | null;
    /** Counts per month, most recent first ("0m" = this month). */
    trend: Array<{ period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }>;
    changes: Array<{ date: number; firm: string; from: string | null; to: string | null; action: string | null }>;
  };
  source: string;
};

const raw = (v: any): number | null => n(v?.raw ?? v);

export async function profile(symbol: string): Promise<CompanyProfile> {
  const modules = "assetProfile,price,financialData,recommendationTrend,upgradeDowngradeHistory";
  const json = await yfetch(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`,
    true
  );
  const r = json?.quoteSummary?.result?.[0];
  if (!r) throw new Error("yahoo: no profile for " + symbol);
  const ap = r.assetProfile ?? {};
  const pr = r.price ?? {};
  const fd = r.financialData ?? {};
  return {
    symbol: pr.symbol ?? symbol,
    name: pr.longName ?? pr.shortName ?? null,
    sector: ap.sector ?? null,
    industry: ap.industry ?? null,
    country: ap.country ?? null,
    city: ap.city ?? null,
    website: ap.website ?? null,
    employees: n(ap.fullTimeEmployees),
    description: ap.longBusinessSummary ?? null,
    officers: (ap.companyOfficers ?? []).slice(0, 6).map((o: any) => ({ name: o.name, title: o.title ?? null })),
    exchange: pr.exchangeName ?? null,
    currency: pr.currency ?? fd.financialCurrency ?? null,
    marketCap: raw(pr.marketCap),
    analysts: {
      recommendation: fd.recommendationKey ?? null,
      mean: raw(fd.recommendationMean),
      count: raw(fd.numberOfAnalystOpinions),
      targetMean: raw(fd.targetMeanPrice),
      targetHigh: raw(fd.targetHighPrice),
      targetLow: raw(fd.targetLowPrice),
      targetMedian: raw(fd.targetMedianPrice),
      price: raw(fd.currentPrice ?? pr.regularMarketPrice),
      trend: (r.recommendationTrend?.trend ?? []).map((t: any) => ({
        period: t.period,
        strongBuy: t.strongBuy ?? 0,
        buy: t.buy ?? 0,
        hold: t.hold ?? 0,
        sell: t.sell ?? 0,
        strongSell: t.strongSell ?? 0,
      })),
      changes: (r.upgradeDowngradeHistory?.history ?? []).slice(0, 15).map((h: any) => ({
        date: h.epochGradeDate,
        firm: h.firm,
        from: h.fromGrade || null,
        to: h.toGrade || null,
        action: h.action ?? null,
      })),
    },
    source: "yahoo",
  };
}

// ---- financial statements (fundamentals-timeseries) ----

export const STATEMENT_FIELDS = {
  income: ["TotalRevenue", "GrossProfit", "OperatingIncome", "EBITDA", "NetIncome", "DilutedEPS"],
  balance: ["TotalAssets", "TotalLiabilitiesNetMinorityInterest", "StockholdersEquity", "CashAndCashEquivalents", "TotalDebt"],
  cashflow: ["OperatingCashFlow", "CapitalExpenditure", "FreeCashFlow"],
} as const;

export type Statements = {
  symbol: string;
  freq: "annual" | "quarterly";
  /** Period end dates (YYYY-MM-DD), oldest first. */
  periods: string[];
  /** field -> value per period (aligned with `periods`). */
  rows: Record<string, Array<number | null>>;
  currency: string | null;
  source: string;
};

export async function statements(symbol: string, freq: "annual" | "quarterly"): Promise<Statements> {
  const fields = Object.values(STATEMENT_FIELDS).flat();
  const types = fields.map((f) => freq + f).join(",");
  const now = Math.floor(Date.now() / 1000);
  const json = await yfetch(
    `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(
      symbol
    )}?type=${types}&period1=${now - 6 * 365 * 86_400}&period2=${now}`,
    true
  );
  const results: any[] = json?.timeseries?.result ?? [];
  const byField = new Map<string, Map<string, number | null>>();
  const dates = new Set<string>();
  let currency: string | null = null;
  for (const r of results) {
    const type: string = r?.meta?.type?.[0] ?? "";
    const field = type.slice(freq.length);
    const points: any[] = r[type] ?? [];
    const m = new Map<string, number | null>();
    for (const p of points) {
      if (!p?.asOfDate) continue;
      dates.add(p.asOfDate);
      m.set(p.asOfDate, raw(p.reportedValue));
      currency ??= p.currencyCode ?? null;
    }
    byField.set(field, m);
  }
  const periods = [...dates].sort().slice(freq === "annual" ? -5 : -8);
  if (periods.length === 0) throw new Error("yahoo: no financial statements for " + symbol);
  const rows: Statements["rows"] = {};
  for (const f of fields) rows[f] = periods.map((d) => byField.get(f)?.get(d) ?? null);
  return { symbol, freq, periods, rows, currency, source: "yahoo" };
}
