// Characters seen in Yahoo-style tickers: AAPL, BRK-B, ^GSPC, 0700.HK,
// EURUSD=X, GC=F, M&M.NS. Commas are excluded because the quote endpoints
// take comma-separated symbol lists, and at least one alphanumeric is required
// so dot-only values like ".." can't act as path segments.
const SYMBOL_RE = /^(?=.*[A-Z0-9])[A-Z0-9.\-^=&]{1,20}$/;

// Common platform names for the Nasdaq-100 futures/index, mapped to Yahoo tickers.
const ALIASES: Record<string, string> = {
  US100: "NQ=F",
  NAS100: "NQ=F",
  USTEC: "NQ=F",
  NQ: "NQ=F",
  "NQ1!": "NQ=F",
  MNQ: "MNQ=F",
  "MNQ1!": "MNQ=F",
  NDX: "^NDX",
};

/** Uppercases and trims free-text ticker input (resolving aliases); null when it isn't a plausible symbol. */
export function normalizeSymbol(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  const s = ALIASES[upper] ?? upper;
  return SYMBOL_RE.test(s) ? s : null;
}

/** Encodes symbols for a `?symbols=` query, keeping the comma separator literal. */
export function symbolsParam(symbols: string[]): string {
  return symbols.map(encodeURIComponent).join(",");
}
