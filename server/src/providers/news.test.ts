import { afterEach, describe, expect, it, vi } from "vitest";
import { feedNews, isFeedSource, parseRss } from "./news.js";

const rss = (items: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items}</channel></rss>`;

describe("news provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips the FinancialJuice prefix and tolerates bad dates", () => {
    const items = parseRss(
      rss(`<item><title>FinancialJuice: US CPI YoY Actual 3.1% (Forecast 3.0%)</title><link>https://www.financialjuice.com/News/1/x.aspx</link><pubDate>Fri, 23 Oct 2026 14:30:00 GMT</pubDate></item>
           <item><title>No date</title><link>https://example.com/a</link><pubDate>garbage</pubDate></item>`),
      "FinancialJuice",
      null
    );
    expect(items[0]).toMatchObject({ title: "US CPI YoY Actual 3.1% (Forecast 3.0%)", publisher: "FinancialJuice", publishedAt: "2026-10-23T14:30:00.000Z" });
    expect(items[1].publishedAt).toBeNull();
  });

  it("handles a single-item feed", () => {
    expect(parseRss(rss(`<item><title>Only</title><link>https://example.com/o</link></item>`), "Yahoo Finance", null)).toHaveLength(1);
  });

  it("merges Bloomberg sections and survives one failing feed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => rss(`<item><title>Markets story</title><link>https://www.bloomberg.com/a</link></item>`) })
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    const items = await feedNews("bloomberg");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(items.map((i) => i.title)).toEqual(["Markets story"]);
    expect(items[0].publisher).toBe("Bloomberg");
  });

  it("only accepts known sources", () => {
    expect(isFeedSource("financialjuice")).toBe(true);
    expect(isFeedSource("finviz")).toBe(false);
    expect(isFeedSource("__proto__")).toBe(false);
  });
});
