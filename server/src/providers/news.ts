import { XMLParser } from "fast-xml-parser";

export type NewsItem = {
  title: string;
  link: string;
  publisher: string;
  publishedAt: string | null;
  symbol: string | null;
};

const parser = new XMLParser({ ignoreAttributes: false });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/** Parse an RSS 2.0 document. Exported for tests. */
export function parseRss(xml: string, publisher: string, symbol: string | null): NewsItem[] {
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item ?? [];
  const list = Array.isArray(items) ? items : [items];
  return list
    .filter((i: any) => i?.title && i?.link)
    .map((i: any) => ({
      title: cleanTitle(String(i.title?.["#text"] ?? i.title)),
      link: String(i.link?.["#text"] ?? i.link).trim(),
      publisher: i.source?.["#text"] ?? publisher,
      publishedAt: toIso(i.pubDate),
      symbol,
    }));
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// FinancialJuice prefixes every headline with its own name.
function cleanTitle(title: string): string {
  return title.replace(/^FinancialJuice:\s*/i, "").trim();
}

async function fetchRss(url: string, publisher: string, symbol: string | null): Promise<NewsItem[]> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`rss ${res.status} ${url}`);
  return parseRss(await res.text(), publisher, symbol);
}

export async function symbolNews(symbol: string): Promise<NewsItem[]> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  return fetchRss(url, "Yahoo Finance", symbol);
}

export async function topNews(query = "stock market"): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  return fetchRss(url, "Google News", null);
}

/**
 * Named headline feeds. All are the publishers' own public RSS feeds, which
 * only carry headlines (Bloomberg adds a one-line summary we don't show) and
 * link back to the original site for the full story.
 * Finviz is intentionally absent: it has no public RSS and its terms forbid
 * automated scraping of the site.
 */
export const FEEDS = {
  financialjuice: [{ url: "https://www.financialjuice.com/feed.ashx?xy=rss", publisher: "FinancialJuice" }],
  bloomberg: [
    { url: "https://feeds.bloomberg.com/markets/news.rss", publisher: "Bloomberg" },
    { url: "https://feeds.bloomberg.com/economics/news.rss", publisher: "Bloomberg" },
  ],
  yahoo: [
    { url: "https://finance.yahoo.com/news/rssindex", publisher: "Yahoo Finance" },
    // rssindex answers 404 from some regions (seen from Brazil); the headline
    // feed for the major US indices is served everywhere.
    {
      url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC,%5EIXIC,%5EDJI&region=US&lang=en-US",
      publisher: "Yahoo Finance",
    },
  ],
} as const;

export type FeedSource = keyof typeof FEEDS;

export function isFeedSource(s: string): s is FeedSource {
  return Object.prototype.hasOwnProperty.call(FEEDS, s);
}

/** Fetch every URL of a named feed; throws only if all of them fail. */
export async function feedNews(source: FeedSource): Promise<NewsItem[]> {
  const lists = await Promise.allSettled(FEEDS[source].map((f) => fetchRss(f.url, f.publisher, null)));
  const ok = lists.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<NewsItem[]>).value);
  if (ok.length === 0) throw new Error(`${source} feed failed`);
  return ok.flat();
}

/** Merge, de-duplicate by normalized title, newest first. */
export function dedupe(lists: NewsItem[][]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of lists.flat()) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}
