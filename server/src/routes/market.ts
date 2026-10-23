import { Router } from "express";
import { cached, cacheGet, cacheStore, staleGet } from "../cache.js";
import { tracked, withFallback } from "../providers/registry.js";
import * as yahoo from "../providers/yahoo.js";
import * as stooq from "../providers/stooq.js";
import * as nasdaq from "../providers/nasdaq.js";
import * as fred from "../providers/fred.js";
import * as ecb from "../providers/ecb.js";
import * as tradingview from "../providers/tradingview.js";
import * as coingecko from "../providers/coingecko.js";
import * as binance from "../providers/binance.js";
import * as news from "../providers/news.js";
import * as econcalendar from "../providers/econcalendar.js";
import * as finra from "../providers/finra.js";
import * as secedgar from "../providers/secedgar.js";
import * as openbb from "../providers/openbb.js";
import * as bcb from "../providers/bcb.js";
import * as tesouro from "../providers/tesouro.js";
import { isIntraday, isSubMinute, lastSession, parseInterval, rangeStart, resample, type Interval } from "../timeframe.js";

export const marketRouter = Router();

const QUOTE_TTL = 1_000;
const HISTORY_TTL = 20_000;
const NEWS_TTL = 60_000;

function fail(req: any, res: any, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error("[market]", req.path, detail);
  res.status(502).json({ error: "All data providers are temporarily unavailable. Try again shortly." });
}

// ---- VIX: served from FRED (daily close), since it's an index rather than a
// tradable stock/ETF — Nasdaq's stock API doesn't carry it, and routing it
// through Yahoo would make it depend on Yahoo's flaky rate limits for no reason.

function isVix(symbol: string): boolean {
  return symbol.toUpperCase() === "^VIX" || symbol.toUpperCase() === "VIX";
}

async function vixQuote(): Promise<yahoo.Quote> {
  const points = await fred.series("VIXCLS", 5);
  if (points.length === 0) throw new Error("fred: no VIX data");
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const price = last.value;
  const previousClose = prev?.value ?? null;
  const change = previousClose !== null ? price - previousClose : null;
  const changePercent = previousClose ? (change! / previousClose) * 100 : null;
  return {
    symbol: "^VIX",
    name: "CBOE Volatility Index",
    price,
    change,
    changePercent,
    open: null,
    high: null,
    low: null,
    previousClose,
    bid: null,
    ask: null,
    volume: null,
    avgVolume: null,
    marketCap: null,
    pe: null,
    eps: null,
    dividendYield: null,
    week52High: null,
    week52Low: null,
    beta: null,
    sharesOutstanding: null,
    currency: "USD",
    exchange: "CBOE",
    marketState: null,
    time: null,
    source: "fred",
  };
}

const VIX_RANGE_N: Record<string, number> = {
  "1D": 5,
  "5D": 5,
  "1M": 22,
  "6M": 130,
  YTD: 200,
  "1Y": 252,
  "5Y": 1260,
  MAX: 20_000,
};

async function vixHistory(rangeKey: string): Promise<yahoo.Candle[]> {
  const n = VIX_RANGE_N[rangeKey] ?? 130;
  const points = await fred.series("VIXCLS", n);
  return points.map((p) => {
    const time = Math.floor(new Date(p.date + "T00:00:00Z").getTime() / 1000);
    return { time, open: p.value, high: p.value, low: p.value, close: p.value, volume: 0 };
  });
}

// ---- quotes (per-symbol cache, so overlapping widgets share one fetch) ----

/**
 * Resolve quotes for a symbol list, reusing a per-symbol cache across every
 * caller (single quote widget, watchlist, screener, heatmap all share hits).
 * Nasdaq's public quote API is primary (no key, generous limits); Yahoo and
 * Stooq are fallbacks. A symbol that fails everywhere still falls back to
 * its last-known value instead of failing the whole batch.
 *
 * Fan-out bound: the /quotes route caps `symbols` at 150, so a single call
 * here does at most ~150 crypto lookups (only for recognized crypto symbols,
 * mutually exclusive with the stages below) + up to 300 Nasdaq calls (2 per
 * miss) + 1 batched Yahoo call + up to FALLBACK_PER_SYMBOL_CAP per-symbol
 * Yahoo chart calls + up to FALLBACK_PER_SYMBOL_CAP Stooq calls + 1 batched
 * TradingView call. Repetition beyond that is bounded by marketRouter's
 * per-IP rate limit (see index.ts).
 */
const FALLBACK_PER_SYMBOL_CAP = 20;
async function getQuotes(symbols: string[]): Promise<yahoo.Quote[]> {
  const fresh = new Map<string, yahoo.Quote>();
  const missing: string[] = [];
  for (const sym of symbols) {
    const hit = cacheGet<yahoo.Quote>(`quote:${sym}`);
    if (hit) fresh.set(sym, hit);
    else missing.push(sym);
  }
  if (missing.length === 0) return symbols.map((s) => fresh.get(s)!).filter(Boolean);

  const fetched = new Map<string, yahoo.Quote>();
  let remaining = missing;

  const cryptoSymbols = remaining.filter((s) => binance.CRYPTO_SYMBOLS.has(s));
  if (cryptoSymbols.length > 0) {
    const results = await Promise.allSettled(cryptoSymbols.map((s) => binance.quote(s)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") fetched.set(cryptoSymbols[i], r.value);
    });
    remaining = remaining.filter((s) => !fetched.has(s));
  }

  const vixSymbols = remaining.filter((s) => isVix(s));
  if (vixSymbols.length > 0) {
    const results = await Promise.allSettled(vixSymbols.map(() => vixQuote()));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") fetched.set(vixSymbols[i], r.value);
    });
    remaining = remaining.filter((s) => !fetched.has(s));
  }

  // OpenBB (when configured) answers the whole batch in one request; anything
  // it misses continues down the free-provider chain below.
  if (remaining.length > 0 && openbb.enabled()) {
    try {
      const rows = await tracked("openbb", () => openbb.quotes(remaining));
      const wanted = new Set(remaining);
      for (const q of rows) if (wanted.has(q.symbol)) fetched.set(q.symbol, q);
      remaining = remaining.filter((s) => !fetched.has(s));
    } catch {
      // fall through to the public providers
    }
  }

  const nasdaqResults = await Promise.allSettled(remaining.map((s) => nasdaq.quote(s)));
  nasdaqResults.forEach((r, i) => {
    if (r.status === "fulfilled") fetched.set(remaining[i], r.value);
  });
  remaining = remaining.filter((s) => !fetched.has(s));

  if (remaining.length > 0) {
    try {
      const rows = await yahoo.quotes(remaining);
      for (const q of rows) fetched.set(q.symbol, q);
      remaining = remaining.filter((s) => !fetched.has(s));
    } catch {
      // fall through to chart-based per-symbol fetch below
    }
  }

  if (remaining.length > 0) {
    const batch = remaining.slice(0, FALLBACK_PER_SYMBOL_CAP);
    const results = await Promise.allSettled(batch.map((s) => yahoo.quoteFromChart(s)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") fetched.set(batch[i], r.value);
    });
    remaining = remaining.filter((s) => !fetched.has(s));
  }

  if (remaining.length > 0) {
    const batch = remaining.slice(0, FALLBACK_PER_SYMBOL_CAP);
    const results = await Promise.allSettled(batch.map((s) => stooq.quote(s)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") fetched.set(batch[i], r.value);
    });
  }

  // Fill gaps Nasdaq's quote endpoints don't cover (open, P/E, EPS, dividend
  // yield, beta, shares outstanding) from TradingView's public scanner API,
  // in one batched request for every quote that resolved an exchange.
  const needsFundamentals = [...fetched.values()].filter((q) => q.exchange && q.pe === null);
  if (needsFundamentals.length > 0) {
    try {
      const fundamentals = await tradingview.scanFundamentals(
        needsFundamentals.map((q) => ({ symbol: q.symbol, exchange: q.exchange }))
      );
      for (const q of needsFundamentals) {
        const f = fundamentals.get(q.symbol);
        if (!f) continue;
        q.open = q.open ?? f.open;
        q.pe = q.pe ?? f.pe;
        q.eps = q.eps ?? f.eps;
        q.dividendYield = q.dividendYield ?? f.dividendYield;
        q.beta = q.beta ?? f.beta;
        q.sharesOutstanding = q.sharesOutstanding ?? f.sharesOutstanding;
      }
    } catch {
      // best-effort enrichment only — never fails the quote request
    }
  }

  for (const [sym, q] of fetched) cacheStore(`quote:${sym}`, q, QUOTE_TTL);

  const out: yahoo.Quote[] = [];
  for (const sym of symbols) {
    const q = fresh.get(sym) ?? fetched.get(sym) ?? staleGet<yahoo.Quote>(`quote:${sym}`);
    if (q) out.push(q);
  }
  return out;
}

marketRouter.get("/quotes", async (req, res) => {
  const symbols = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 150);
  if (symbols.length === 0) return res.status(400).json({ error: "symbols required" });
  try {
    const data = await getQuotes(symbols);
    if (data.length === 0) throw new Error("no quotes from any provider");
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- history / candles ----

marketRouter.get("/history/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const rangeKey = String(req.query.range ?? "6M");
  const rawInterval = req.query.interval === undefined ? "" : String(req.query.interval);
  const iv = rawInterval && rawInterval !== "auto" ? parseInterval(rawInterval) : null;
  if (rawInterval && rawInterval !== "auto" && !iv) {
    res.status(400).json({ error: `invalid interval "${rawInterval.slice(0, 20)}" (examples: 1m, 15m, 4h, 1D, 1W, 1M)` });
    return;
  }
  try {
    const data = await cached(`history:${symbol}:${rangeKey}:${iv?.key ?? "auto"}`, HISTORY_TTL, () =>
      iv
        ? historyAtInterval(symbol, rangeKey, iv)
        : binance.CRYPTO_SYMBOLS.has(symbol)
        ? binance.history(symbol, rangeKey)
        : isVix(symbol)
        ? vixHistory(rangeKey)
        : withFallback([
            ...openbbFirst(() => openbb.history(symbol, rangeKey)),
            ["nasdaq", () => nasdaq.history(symbol, rangeKey)],
            ["yahoo", () => yahoo.history(symbol, yahooRange(rangeKey).range, yahooRange(rangeKey).interval)],
            ["stooq", () => stooq.history(symbol)],
          ])
    );
    if (!Array.isArray(data) || data.length === 0) throw new Error("empty history from all providers");
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

/**
 * History at an explicit timeframe (1m, 15m, 4h, 1D, 2W, 1M, ...). Intraday
 * bars only come from sources that have them (Binance, OpenBB, Yahoo); daily
 * and longer can also be rebuilt from Nasdaq/Stooq daily bars.
 */
async function historyAtInterval(symbol: string, rangeKey: string, iv: Interval): Promise<yahoo.Candle[]> {
  const now = Date.now();
  if (binance.CRYPTO_SYMBOLS.has(symbol)) {
    // Crypto trades 24/7, so "1D" really means the last 24 hours.
    const start = rangeKey === "1D" ? now - 86_400_000 : rangeStart(rangeKey, now);
    return binance.historyInterval(symbol, start, iv);
  }
  if (isSubMinute(iv)) throw new Error("second-level bars are only available for crypto");
  const start = rangeStart(rangeKey, now);
  const sinceStart = (cs: yahoo.Candle[]) => {
    const kept = cs.filter((c) => c.time * 1000 >= start);
    if (kept.length === 0) throw new Error("no bars in the requested range");
    return kept;
  };
  if (isVix(symbol)) {
    if (isIntraday(iv)) throw new Error("VIX is only available with daily bars or longer");
    return resample(sinceStart(await vixHistory("MAX")), iv);
  }
  const chain: Array<[string, () => Promise<yahoo.Candle[]>]> = [
    ...openbbFirst(() => openbb.historyInterval(symbol, start, iv, now)),
    ["yahoo", () => yahoo.historyInterval(symbol, start, iv, now)],
  ];
  if (!isIntraday(iv)) {
    chain.push(
      ["nasdaq", async () => resample(sinceStart(await nasdaq.history(symbol, "MAX")), iv)],
      ["stooq", async () => resample(sinceStart(await stooq.history(symbol)), iv)]
    );
  }
  const candles = await withFallback(chain);
  return rangeKey === "1D" && isIntraday(iv) ? lastSession(candles) : candles;
}

/** Prepends OpenBB to a fallback chain only when OPENBB_URL is configured. */
function openbbFirst<T>(fn: () => Promise<T>): Array<[string, () => Promise<T>]> {
  return openbb.enabled() ? [["openbb", fn]] : [];
}

function yahooRange(rangeKey: string): { range: string; interval: string } {
  const map: Record<string, { range: string; interval: string }> = {
    "1D": { range: "1d", interval: "5m" },
    "5D": { range: "5d", interval: "15m" },
    "1M": { range: "1mo", interval: "1h" },
    "6M": { range: "6mo", interval: "1d" },
    YTD: { range: "ytd", interval: "1d" },
    "1Y": { range: "1y", interval: "1d" },
    "5Y": { range: "5y", interval: "1wk" },
    MAX: { range: "max", interval: "1mo" },
  };
  return map[rangeKey] ?? map["6M"];
}

// ---- Brazil: policy rates from the central bank (Selic, CDI, IPCA 12m) ----

marketRouter.get("/brazil/rates", async (req, res) => {
  try {
    res.json(await cached("bcb:rates", 3_600_000, () => tracked("bcb", () => bcb.rates())));
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- fundamentals (OpenBB only: valuation, margins, growth, balance-sheet health) ----

marketRouter.get("/fundamentals/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!openbb.enabled()) {
    return res.status(503).json({ error: "Fundamentals need the OpenBB service. Set OPENBB_URL (see README)." });
  }
  try {
    const data = await cached(`fundamentals:${symbol}`, 3_600_000, () =>
      withFallback([["openbb", () => openbb.fundamentals(symbol)]])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- company description (DES) + analyst consensus (ANR): Yahoo, OpenBB profile as fallback ----

marketRouter.get("/company/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const sources: Array<[string, () => Promise<yahoo.CompanyProfile>]> = [["yahoo", () => yahoo.profile(symbol)]];
    if (openbb.enabled()) {
      sources.push([
        "openbb",
        async () => {
          const f = await openbb.fundamentals(symbol);
          return {
            symbol, name: f.name, sector: f.sector, industry: f.industry, country: null, city: null,
            website: f.website, employees: f.employees, description: f.description, officers: [],
            exchange: null, currency: f.currency, marketCap: f.marketCap,
            analysts: {
              recommendation: null, mean: null, count: null, targetMean: null, targetHigh: null,
              targetLow: null, targetMedian: null, price: null, trend: [], changes: [],
            },
            source: "openbb",
          };
        },
      ]);
    }
    res.json(await cached(`company:${symbol}`, 3_600_000, () => withFallback(sources)));
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- financial statements (FA) ----

marketRouter.get("/financials/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const freq = req.query.freq === "quarterly" ? "quarterly" : "annual";
  try {
    res.json(
      await cached(`financials:${symbol}:${freq}`, 6 * 3_600_000, () =>
        withFallback([["yahoo", () => yahoo.statements(symbol, freq)]])
      )
    );
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- peers (RV): same sector, closest market cap, from the market-wide scan ----

marketRouter.get("/peers/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    let market: "us" | "eu" = "us";
    let rows = await marketRows("us");
    let me = rows.find((r) => r.symbol === symbol);
    if (!me) {
      // European tickers come as "SAP.DE" from Yahoo but "SAP" from TradingView.
      const bare = symbol.split(".")[0];
      rows = await marketRows("eu").catch(() => []);
      me = rows.find((r) => r.symbol === bare);
      market = "eu";
    }
    if (!me || !me.marketCap) {
      return res.status(404).json({ error: "Peers are only available for US and European stocks." });
    }
    const cap = me.marketCap;
    const peers = rows
      .filter((r) => r.sector === me!.sector && r.symbol !== me!.symbol && r.marketCap)
      .sort((a, b) => Math.abs(Math.log(a.marketCap! / cap)) - Math.abs(Math.log(b.marketCap! / cap)))
      .slice(0, 9);
    const group = [me, ...peers];
    let extra = new Map<string, yahoo.Quote>();
    if (market === "us") {
      const q = await getQuotes(group.map((r) => r.symbol)).catch(() => []);
      extra = new Map(q.map((x) => [x.symbol, x]));
    }
    res.json({
      symbol: me.symbol,
      sector: me.sector,
      market,
      rows: group.map((r) => {
        const q = extra.get(r.symbol);
        return {
          symbol: r.symbol,
          name: r.name,
          price: r.price,
          changePercent: r.changePercent,
          marketCap: r.marketCap,
          pe: r.pe ?? q?.pe ?? null,
          eps: q?.eps ?? null,
          dividendYield: q?.dividendYield ?? null,
          beta: q?.beta ?? null,
          week52High: q?.week52High ?? null,
          week52Low: q?.week52Low ?? null,
        };
      }),
    });
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- yield curves (GC): US Treasuries (FRED), euro-area AAA (ECB), Brazil (Tesouro Direto) ----

const US_CURVE: Array<{ id: string; tenor: string; years: number }> = [
  { id: "DGS1MO", tenor: "1M", years: 1 / 12 },
  { id: "DGS3MO", tenor: "3M", years: 0.25 },
  { id: "DGS6MO", tenor: "6M", years: 0.5 },
  { id: "DGS1", tenor: "1Y", years: 1 },
  { id: "DGS2", tenor: "2Y", years: 2 },
  { id: "DGS3", tenor: "3Y", years: 3 },
  { id: "DGS5", tenor: "5Y", years: 5 },
  { id: "DGS7", tenor: "7Y", years: 7 },
  { id: "DGS10", tenor: "10Y", years: 10 },
  { id: "DGS20", tenor: "20Y", years: 20 },
  { id: "DGS30", tenor: "30Y", years: 30 },
];

const EU_CURVE: Array<{ tenor: string; years: number }> = [
  { tenor: "3M", years: 0.25 }, { tenor: "6M", years: 0.5 }, { tenor: "1Y", years: 1 }, { tenor: "2Y", years: 2 },
  { tenor: "3Y", years: 3 }, { tenor: "5Y", years: 5 }, { tenor: "7Y", years: 7 }, { tenor: "10Y", years: 10 },
  { tenor: "20Y", years: 20 }, { tenor: "30Y", years: 30 },
];

type CurveOut = { label: string; date: string | null; points: Array<{ tenor: string; years: number; value: number }> };

async function curveFrom<T extends { tenor: string; years: number }>(
  label: string,
  defs: T[],
  load: (d: T) => Promise<{ date: string; value: number } | null>
): Promise<CurveOut> {
  const res = await Promise.allSettled(defs.map(load));
  const points: CurveOut["points"] = [];
  let date: string | null = null;
  res.forEach((r, i) => {
    if (r.status !== "fulfilled" || !r.value) return;
    points.push({ tenor: defs[i].tenor, years: defs[i].years, value: r.value.value });
    if (!date || r.value.date > date) date = r.value.date;
  });
  return { label, date, points };
}

marketRouter.get("/curves", async (req, res) => {
  try {
    const out = await cached("curves", 1_800_000, async () => {
      const [us, eu, br] = await Promise.all([
        curveFrom("US Treasury", US_CURVE, (d) => cached(`fred:${d.id}`, 300_000, () => tracked("fred", () => fred.latest(d.id)))),
        curveFrom("Euro AAA", EU_CURVE, (d) => {
          const key = `B.U2.EUR.4F.G_N_A.SV_C_YM.SR_${d.tenor}`;
          return cached(`ecb:${key}`, 300_000, () => tracked("ecb", () => ecb.latest("YC", key)));
        }),
        cached("tesouro:curves", 6 * 3_600_000, () => tracked("tesouro", () => tesouro.curves())).catch(() => null),
      ]);
      const toPoints = (ps: tesouro.CurvePoint[]) =>
        ps.map((p) => ({ tenor: p.maturity.slice(0, 4), years: p.years, value: p.value }));
      const curves: CurveOut[] = [us, eu];
      if (br) {
        curves.push({ label: "Brazil Prefixado", date: br.date, points: toPoints(br.nominal) });
        curves.push({ label: "Brazil IPCA+ (real)", date: br.date, points: toPoints(br.real) });
      }
      const filled = curves.filter((c) => c.points.length > 0);
      if (filled.length === 0) throw new Error("no curve data from any provider");
      return filled;
    });
    res.json(out);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- search ----

marketRouter.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.json([]);
  try {
    const data = await cached(`search:${q.toLowerCase()}`, 300_000, () =>
      withFallback([
        ["tradingview", () => tradingview.search(q)],
        ["yahoo", () => yahoo.search(q)],
      ])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- news ----

marketRouter.get("/news", async (req, res) => {
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
  const source = req.query.source ? String(req.query.source).toLowerCase() : null;
  if (source && !news.isFeedSource(source)) {
    res.status(400).json({ error: "unknown news source" });
    return;
  }
  try {
    const data = await cached(`news:${source ?? symbol ?? "top"}`, NEWS_TTL, async () => {
      if (source && news.isFeedSource(source)) {
        return news.dedupe([await news.feedNews(source)]).slice(0, 60);
      }
      if (symbol) {
        const lists = await Promise.allSettled([news.symbolNews(symbol), news.topNews(symbol + " stock")]);
        const ok = lists.filter((r) => r.status === "fulfilled").map((r) => (r as any).value);
        if (ok.length === 0) throw new Error("all news sources failed");
        return news.dedupe(ok).slice(0, 40);
      }
      const lists = await Promise.allSettled([
        news.topNews("stock market"),
        news.topNews("federal reserve economy"),
        news.feedNews("financialjuice"),
        news.feedNews("bloomberg"),
        news.feedNews("yahoo"),
      ]);
      const ok = lists.filter((r) => r.status === "fulfilled").map((r) => (r as any).value);
      if (ok.length === 0) throw new Error("all news sources failed");
      return news.dedupe(ok).slice(0, 60);
    });
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- economic calendar (Fed / ECB / CPI / NFP with forecast + actual) ----

marketRouter.get("/econ-calendar", async (req, res) => {
  try {
    const data = await cached("econ-calendar", 900_000, () => econcalendar.weeklyEvents());
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- options ----

marketRouter.get("/options/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const expiry = req.query.expiry ? String(req.query.expiry) : undefined;
  try {
    const data = await cached(`options:${symbol}:${expiry ?? "front"}`, 60_000, () =>
      withFallback([
        ["nasdaq", () => nasdaq.optionChain(symbol, expiry)],
        [
          "yahoo",
          async () => {
            const y = await yahoo.options(symbol);
            return {
              symbol: y.symbol,
              underlyingPrice: y.underlyingPrice,
              expirationDates: y.expirationDates.map((d: number) => new Date(d * 1000).toISOString().slice(0, 10)),
              selectedDate: y.selectedDate ? new Date(y.selectedDate * 1000).toISOString().slice(0, 10) : null,
              calls: y.calls,
              puts: y.puts,
            };
          },
        ],
      ])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- crypto ----

marketRouter.get("/crypto", async (req, res) => {
  try {
    const data = await cached("crypto:markets", 5_000, () =>
      withFallback([
        ["coingecko", () => coingecko.markets(50)],
        ["binance", () => binance.markets()],
      ])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

marketRouter.get("/crypto/global", async (req, res) => {
  try {
    const data = await cached("crypto:global", 120_000, () =>
      withFallback([["coingecko", () => coingecko.globalStats()]])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

marketRouter.get("/crypto/orderbook/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!binance.CRYPTO_SYMBOLS.has(symbol)) {
    return res.status(400).json({ error: "unsupported crypto symbol" });
  }
  try {
    const data = await cached(`orderbook:${symbol}`, 5_000, () =>
      withFallback([["binance", () => binance.orderBook(symbol)]])
    );
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- macro: treasury yield curve (FRED) + key indexes via ETF proxies (Nasdaq) ----

const YIELD_SERIES: Array<{ id: string; tenor: string }> = [
  { id: "DGS3MO", tenor: "3M" },
  { id: "DGS5", tenor: "5Y" },
  { id: "DGS10", tenor: "10Y" },
  { id: "DGS30", tenor: "30Y" },
];

const INDEX_PROXIES: Record<string, string> = {
  SPY: "S&P 500 (SPY)",
  DIA: "Dow Jones (DIA)",
  QQQ: "Nasdaq 100 (QQQ)",
  IWM: "Russell 2000 (IWM)",
  GLD: "Gold (GLD)",
  USO: "WTI Crude (USO)",
  TLT: "20Y+ Treasury (TLT)",
  UUP: "Dollar Index (UUP)",
};

// ---- EU macro: ECB AAA euro-area yield curve + policy rate + HICP inflation,
// plus key European indexes via US-listed ETF proxies (same trick as the US
// index proxies above — Nasdaq/Yahoo already carry these tickers, so no new
// quote provider is needed).

const EU_YIELD_SERIES: Array<{ flowRef: string; key: string; tenor: string }> = [
  { flowRef: "YC", key: "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_3M", tenor: "3M" },
  { flowRef: "YC", key: "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_5Y", tenor: "5Y" },
  { flowRef: "YC", key: "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y", tenor: "10Y" },
  { flowRef: "YC", key: "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_30Y", tenor: "30Y" },
];

// Deposit facility rate — the ECB's operative policy rate since the 2024
// operational framework review (not the main refinancing rate).
const EU_POLICY_RATE = { flowRef: "FM", key: "D.U2.EUR.4F.KR.DFR.LEV" };
const EU_INFLATION = { flowRef: "ICP", key: "M.U2.N.000000.4.ANR" }; // HICP, y/y

const EU_INDEX_PROXIES: Record<string, string> = {
  FEZ: "Euro Stoxx 50 (FEZ)",
  IEUR: "MSCI Europe (IEUR)",
  EWG: "Germany (EWG)",
  EWU: "UK (EWU)",
  EWQ: "France (EWQ)",
  EWI: "Italy (EWI)",
};

marketRouter.get("/macro", async (req, res) => {
  try {
    if (req.query.region === "eu") {
      const [yieldResults, policyRate, inflation, quotes] = await Promise.all([
        Promise.allSettled(
          EU_YIELD_SERIES.map((s) => cached(`ecb:${s.key}`, 300_000, () => ecb.latest(s.flowRef, s.key)))
        ),
        cached(`ecb:${EU_POLICY_RATE.key}`, 300_000, () => ecb.latest(EU_POLICY_RATE.flowRef, EU_POLICY_RATE.key)).catch(
          () => null
        ),
        cached(`ecb:${EU_INFLATION.key}`, 300_000, () => ecb.latest(EU_INFLATION.flowRef, EU_INFLATION.key)).catch(
          () => null
        ),
        getQuotes(Object.keys(EU_INDEX_PROXIES)),
      ]);
      const yields = EU_YIELD_SERIES.map((s, i) => {
        const r = yieldResults[i];
        return { tenor: s.tenor, value: r.status === "fulfilled" ? r.value?.value ?? null : null };
      }).filter((y) => y.value !== null);

      const indexes = quotes.map((q) => ({
        symbol: q.symbol,
        label: EU_INDEX_PROXIES[q.symbol] ?? q.symbol,
        price: q.price,
        changePercent: q.changePercent,
      }));

      if (yields.length === 0 && indexes.length === 0) throw new Error("no EU macro data from any provider");
      res.json({
        yields,
        vix: null,
        indexes,
        policyRate: policyRate?.value ?? null,
        inflation: inflation?.value ?? null,
      });
      return;
    }

    const [yieldResults, vix, quotes] = await Promise.all([
      Promise.allSettled(YIELD_SERIES.map((s) => cached(`fred:${s.id}`, 300_000, () => fred.latest(s.id)))),
      cached("fred:VIXCLS", 300_000, () => fred.latest("VIXCLS")).catch(() => null),
      getQuotes(Object.keys(INDEX_PROXIES)),
    ]);
    const yields = YIELD_SERIES.map((s, i) => {
      const r = yieldResults[i];
      return { tenor: s.tenor, value: r.status === "fulfilled" ? r.value?.value ?? null : null };
    }).filter((y) => y.value !== null);

    const indexes = quotes.map((q) => ({
      symbol: q.symbol,
      label: INDEX_PROXIES[q.symbol] ?? q.symbol,
      price: q.price,
      changePercent: q.changePercent,
    }));

    if (yields.length === 0 && indexes.length === 0) throw new Error("no macro data from any provider");
    res.json({ yields, vix: vix?.value ?? null, indexes, policyRate: null, inflation: null });
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- heatmap + screener over the full market (TradingView scanner — live) ----
// ?market=eu switches from the whole-US scan to the merged major-European-
// exchanges scan (see tradingview.europeMarketScan).

function marketParam(req: any): "us" | "eu" {
  return req.query.market === "eu" ? "eu" : "us";
}

// TradingView reports market cap in each stock's own listing currency (SEK,
// GBP, CHF, ...), not EUR — left unconverted, a 1.2T SEK Swedish company would
// outrank a 550B EUR Dutch one in the merged EU scan. Reference rates come
// from the same ECB source as the EU macro widget, so this needs no new
// provider (rate = local-currency units per 1 EUR).
const EU_FX_SERIES: Record<string, { flowRef: string; key: string }> = {
  GBP: { flowRef: "EXR", key: "D.GBP.EUR.SP00.A" },
  SEK: { flowRef: "EXR", key: "D.SEK.EUR.SP00.A" },
  CHF: { flowRef: "EXR", key: "D.CHF.EUR.SP00.A" },
};

async function eurFxRates(): Promise<Record<string, number>> {
  const rates: Record<string, number> = { EUR: 1 };
  const entries = await Promise.all(
    Object.entries(EU_FX_SERIES).map(async ([ccy, s]) => {
      const point = await cached(`ecb:fx:${ccy}`, 3_600_000, () => ecb.latest(s.flowRef, s.key)).catch(() => null);
      return [ccy, point?.value ?? null] as const;
    })
  );
  for (const [ccy, rate] of entries) if (rate) rates[ccy] = rate;
  return rates;
}

async function marketRows(market: "us" | "eu"): Promise<tradingview.MarketRow[]> {
  if (market === "eu") {
    return cached("marketscan:eu", 5_000, async () => {
      const [rows, fx] = await Promise.all([tradingview.europeMarketScan(1500), eurFxRates()]);
      return rows.map((r) => {
        const rate = r.currency ? fx[r.currency] : undefined;
        return rate && r.marketCap ? { ...r, marketCap: r.marketCap / rate } : r;
      });
    });
  }
  return cached("marketscan:full", 3_000, () => tradingview.marketScan(1500));
}

marketRouter.get("/heatmap", async (req, res) => {
  try {
    const rows = await marketRows(marketParam(req));
    const top = rows.filter((r) => r.marketCap).slice(0, 150);
    res.json(top);
  } catch (err) {
    fail(req, res, err);
  }
});

marketRouter.get("/screener", async (req, res) => {
  try {
    let rows = await marketRows(marketParam(req));
    const num = (v: unknown) => (v === undefined ? undefined : Number(v));
    const f = {
      sector: req.query.sector ? String(req.query.sector) : undefined,
      marketCapMin: num(req.query.marketCapMin),
      changeMin: num(req.query.changeMin),
      changeMax: num(req.query.changeMax),
      volumeMin: num(req.query.volumeMin),
      peMin: num(req.query.peMin),
      peMax: num(req.query.peMax),
    };
    rows = rows.filter((r) => {
      if (f.sector && r.sector !== f.sector) return false;
      if (f.marketCapMin !== undefined && (r.marketCap ?? 0) < f.marketCapMin) return false;
      if (f.changeMin !== undefined && (r.changePercent ?? -Infinity) < f.changeMin) return false;
      if (f.changeMax !== undefined && (r.changePercent ?? Infinity) > f.changeMax) return false;
      if (f.volumeMin !== undefined && (r.volume ?? 0) < f.volumeMin) return false;
      // A P/E filter only keeps profitable companies that report one.
      if (f.peMin !== undefined && (r.pe == null || r.pe < f.peMin)) return false;
      if (f.peMax !== undefined && (r.pe == null || r.pe <= 0 || r.pe > f.peMax)) return false;
      return true;
    });
    const sortKey = String(req.query.sort ?? "marketCap") as keyof tradingview.MarketRow;
    const dir = req.query.dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = (a[sortKey] as number | null) ?? -Infinity;
      const bv = (b[sortKey] as number | null) ?? -Infinity;
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
    res.json(rows.slice(0, 500));
  } catch (err) {
    fail(req, res, err);
  }
});

marketRouter.get("/sectors", async (req, res) => {
  try {
    const rows = await marketRows(marketParam(req));
    res.json([...new Set(rows.map((r) => r.sector))].sort());
  } catch (err) {
    res.json([]);
  }
});

// ---- market recap: templated end-of-day-style narrative + supporting stats ----

const RECAP_TTL = 15_000;

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "flat";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function buildRecapSummary(d: {
  indexes: Array<{ symbol: string; label: string; changePercent: number | null }>;
  bestSector?: { sector: string; avgChangePercent: number };
  worstSector?: { sector: string; avgChangePercent: number };
  gainers: tradingview.MarketRow[];
  losers: tradingview.MarketRow[];
  vix: number | null;
}): string {
  const spy = d.indexes.find((i) => i.symbol === "SPY");
  const qqq = d.indexes.find((i) => i.symbol === "QQQ");
  const dia = d.indexes.find((i) => i.symbol === "DIA");
  const spyChange = spy?.changePercent ?? 0;
  const dir = spyChange > 0.15 ? "trading higher" : spyChange < -0.15 ? "trading lower" : "little changed";

  const parts: string[] = [];
  parts.push(
    `US stocks are ${dir}, with the S&P 500 ${pct(spy?.changePercent)}, the Nasdaq 100 ${pct(qqq?.changePercent)} and the Dow ${pct(dia?.changePercent)}.`
  );
  if (d.bestSector && d.worstSector && d.bestSector.sector !== d.worstSector.sector) {
    parts.push(
      `${d.bestSector.sector} is leading sector performance (${pct(d.bestSector.avgChangePercent)}), while ${d.worstSector.sector} lags (${pct(d.worstSector.avgChangePercent)}).`
    );
  }
  if (d.gainers[0] && d.losers[0]) {
    parts.push(
      `${d.gainers[0].name} paces advancers, up ${pct(d.gainers[0].changePercent)}, while ${d.losers[0].name} is the biggest decliner, down ${pct(
        d.losers[0].changePercent
      )}.`
    );
  }
  if (d.vix !== null) {
    parts.push(`The VIX volatility index is at ${d.vix.toFixed(2)}.`);
  }
  return parts.join(" ");
}

marketRouter.get("/recap", async (req, res) => {
  try {
    const data = await cached("recap:full", RECAP_TTL, async () => {
      const [quotes, vix, rows, headlines] = await Promise.all([
        getQuotes(Object.keys(INDEX_PROXIES)),
        cached("fred:VIXCLS", 300_000, () => fred.latest("VIXCLS")).catch(() => null),
        marketRows("us"),
        cached("news:recap", NEWS_TTL, async () => {
          const lists = await Promise.allSettled([
            news.topNews("stock market"),
            news.topNews("federal reserve economy"),
          ]);
          const ok = lists.filter((r) => r.status === "fulfilled").map((r) => (r as any).value);
          if (ok.length === 0) throw new Error("all news sources failed");
          return news.dedupe(ok);
        }),
      ]);

      const indexes = quotes.map((q) => ({
        symbol: q.symbol,
        label: INDEX_PROXIES[q.symbol] ?? q.symbol,
        price: q.price,
        changePercent: q.changePercent,
      }));

      const ranked = rows.filter((r) => (r.marketCap ?? 0) > 2_000_000_000 && r.changePercent !== null);
      const gainers = [...ranked].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0)).slice(0, 5);
      const losers = [...ranked].sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0)).slice(0, 5);

      const sectorMap = new Map<string, { sum: number; count: number }>();
      for (const r of rows) {
        if (r.changePercent === null || !r.sector) continue;
        const cur = sectorMap.get(r.sector) ?? { sum: 0, count: 0 };
        cur.sum += r.changePercent;
        cur.count += 1;
        sectorMap.set(r.sector, cur);
      }
      const sectors = [...sectorMap.entries()]
        .map(([sector, { sum, count }]) => ({ sector, avgChangePercent: sum / count }))
        .sort((a, b) => b.avgChangePercent - a.avgChangePercent);

      const bestSector = sectors[0];
      const worstSector = sectors[sectors.length - 1];

      const summary = buildRecapSummary({ indexes, bestSector, worstSector, gainers, losers, vix: vix?.value ?? null });

      return {
        summary,
        updatedAt: new Date().toISOString(),
        indexes,
        vix: vix?.value ?? null,
        gainers,
        losers,
        sectors: sectors.slice(0, 3).concat(sectors.length > 3 ? sectors.slice(-3) : []),
        news: headlines.slice(0, 6),
      };
    });
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- earnings calendar for a list of symbols ----

marketRouter.get("/calendar", async (req, res) => {
  const symbols = String(req.query.symbols ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 30);
  if (symbols.length === 0) return res.status(400).json({ error: "symbols required" });
  try {
    const data = await cached(`calendar:${symbols.join(",")}`, 3_600_000, () => tradingview.earningsCalendar(symbols));
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- earnings history: forecast vs actual per quarter, plus next-day price move ----

marketRouter.get("/earnings-history/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const data = await cached(`earnings-history:${symbol}`, 3_600_000, async () => {
      const [surprises, candles] = await Promise.all([
        nasdaq.earningsSurprise(symbol),
        withFallback([
          ...openbbFirst(() => openbb.history(symbol, "1Y")),
          ["nasdaq", () => nasdaq.history(symbol, "1Y")],
          ["yahoo", () => yahoo.history(symbol, yahooRange("1Y").range, yahooRange("1Y").interval)],
          ["stooq", () => stooq.history(symbol)],
        ]),
      ]);
      const sorted = [...candles].sort((a, b) => a.time - b.time);
      // Nearest trading-day close on/after a given date, and the close of the
      // trading day right after that — the "day after earnings" move.
      const closeOnOrAfter = (unixSeconds: number) => {
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i].time >= unixSeconds - 3 * 86_400) return i;
        }
        return -1;
      };
      return surprises.map((s) => {
        const idx = closeOnOrAfter(s.dateReported);
        const dayAfterChangePercent =
          idx >= 0 && idx + 1 < sorted.length
            ? ((sorted[idx + 1].close - sorted[idx].close) / sorted[idx].close) * 100
            : null;
        return { ...s, dayAfterChangePercent };
      });
    });
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- short sale volume (FINRA Reg SHO daily file) ----

marketRouter.get("/short-volume/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const day = await cached("finra-shortvol-day", 6 * 3_600_000, () => finra.latestDay());
    const row = day.get(symbol);
    if (!row) return res.json(null);
    res.json({ ...row, shortVolumePercent: (row.shortVolume / row.totalVolume) * 100 });
  } catch (err) {
    fail(req, res, err);
  }
});

// ---- insider transactions (SEC EDGAR Form 4) ----

marketRouter.get("/insider/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const data = await cached(`insider:${symbol}`, 3_600_000, () => secedgar.insiderTransactions(symbol));
    res.json(data);
  } catch (err) {
    fail(req, res, err);
  }
});
