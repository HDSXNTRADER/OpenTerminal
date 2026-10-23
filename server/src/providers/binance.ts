import type { CryptoRow } from "./coingecko.js";
import type { Quote, Candle } from "./yahoo.js";
import { pickBase, resample, type Interval } from "../timeframe.js";

const NAMES: Record<string, string> = {
  BTCUSDT: "Bitcoin", ETHUSDT: "Ethereum", SOLUSDT: "Solana", BNBUSDT: "BNB",
  XRPUSDT: "XRP", ADAUSDT: "Cardano", DOGEUSDT: "Dogecoin", AVAXUSDT: "Avalanche",
  DOTUSDT: "Polkadot", LINKUSDT: "Chainlink", LTCUSDT: "Litecoin", MATICUSDT: "Polygon",
};

/** Plain tickers (BTC, ETH, ...) this app treats as crypto for routing quotes/history. */
export const CRYPTO_SYMBOLS = new Set(Object.keys(NAMES).map((s) => s.replace("USDT", "")));

/** Fallback crypto board built from Binance public 24hr tickers (no key required). */
export async function markets(): Promise<CryptoRow[]> {
  const symbols = Object.keys(NAMES);
  const url =
    "https://api.binance.com/api/v3/ticker/24hr?symbols=" + encodeURIComponent(JSON.stringify(symbols));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`binance ${res.status}`);
  const rows: any[] = await res.json();
  return rows
    .map((r) => ({
      id: r.symbol,
      symbol: r.symbol.replace("USDT", ""),
      name: NAMES[r.symbol] ?? r.symbol,
      price: +r.lastPrice,
      changePercent24h: +r.priceChangePercent,
      marketCap: null,
      volume24h: +r.quoteVolume,
      rank: null,
      sparkline: [],
    }))
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
}

export async function orderBook(symbol: string, limit = 20): Promise<{ bids: [string, string][]; asks: [string, string][] }> {
  const pair = encodeURIComponent(symbol.toUpperCase() + "USDT");
  const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${pair}&limit=${limit}`);
  if (!res.ok) throw new Error(`binance ${res.status}`);
  const d = await res.json();
  return { bids: d.bids ?? [], asks: d.asks ?? [] };
}

/** Single-symbol quote so crypto tickers can flow through the same /api/quotes path as stocks. */
export async function quote(symbol: string): Promise<Quote> {
  const pair = symbol.toUpperCase() + "USDT";
  const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`);
  if (!res.ok) throw new Error(`binance ticker ${res.status}`);
  const d = await res.json();
  return {
    symbol: symbol.toUpperCase(),
    name: NAMES[pair] ?? symbol.toUpperCase(),
    price: +d.lastPrice,
    change: +d.priceChange,
    changePercent: +d.priceChangePercent,
    open: +d.openPrice,
    high: +d.highPrice,
    low: +d.lowPrice,
    previousClose: +d.prevClosePrice,
    bid: +d.bidPrice || null,
    ask: +d.askPrice || null,
    volume: +d.volume,
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
    exchange: "Binance",
    marketState: "Open",
    time: null,
    source: "binance",
  };
}

const RANGE_TO_KLINE: Record<string, { interval: string; limit: number }> = {
  "1D": { interval: "5m", limit: 288 },
  "5D": { interval: "15m", limit: 480 },
  "1M": { interval: "1h", limit: 720 },
  "6M": { interval: "4h", limit: 1080 },
  YTD: { interval: "1d", limit: 400 },
  "1Y": { interval: "1d", limit: 365 },
  "5Y": { interval: "1w", limit: 260 },
  MAX: { interval: "1M", limit: 200 },
};

export async function history(symbol: string, rangeKey: string): Promise<Candle[]> {
  const { interval, limit } = RANGE_TO_KLINE[rangeKey] ?? RANGE_TO_KLINE["6M"];
  const pair = symbol.toUpperCase() + "USDT";
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`
  );
  if (!res.ok) throw new Error(`binance klines ${res.status}`);
  const rows: any[] = await res.json();
  return rows.map((r) => ({
    time: Math.round(r[0] / 1000),
    open: +r[1],
    high: +r[2],
    low: +r[3],
    close: +r[4],
    volume: +r[5],
  }));
}

const BINANCE_NATIVE = {
  minutes: [
    [1 / 60, "1s"], [1, "1m"], [3, "3m"], [5, "5m"], [15, "15m"], [30, "30m"], [60, "1h"], [120, "2h"],
    [240, "4h"], [360, "6h"], [480, "8h"], [720, "12h"],
  ] as Array<[number, string]>,
  day: "1d",
  week: "1w",
  month: "1M",
};

const KLINE_PAGE = 1000;
const KLINE_MAX_PAGES = 10;

/**
 * History at any timeframe. Pages backwards from now (1000 klines per call,
 * at most 10 calls) so the most recent bars are always included.
 */
export async function historyInterval(symbol: string, startMs: number, iv: Interval): Promise<Candle[]> {
  const { base } = pickBase(iv, BINANCE_NATIVE);
  const pair = symbol.toUpperCase() + "USDT";
  const pages: Candle[][] = [];
  let endTime: number | null = null;
  for (let page = 0; page < KLINE_MAX_PAGES; page++) {
    const url =
      `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=${base}&limit=${KLINE_PAGE}` +
      (endTime !== null ? `&endTime=${endTime}` : "");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`binance klines ${res.status}`);
    const rows: any[] = await res.json();
    if (rows.length === 0) break;
    pages.unshift(
      rows
        .filter((r) => r[0] >= startMs)
        .map((r) => ({ time: Math.round(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }))
    );
    if (rows.length < KLINE_PAGE || rows[0][0] <= startMs) break;
    endTime = rows[0][0] - 1;
  }
  return resample(pages.flat(), iv);
}
