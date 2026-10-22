import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// OPENBB_URL is read at module load, so each test imports a fresh copy.
async function load(env: Record<string, string> = { OPENBB_URL: "http://openbb:6900/" }) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("./openbb.js");
}

function mockFetch(...bodies: Array<{ status?: number; json: unknown }>) {
  const fetchMock = vi.fn();
  for (const b of bodies) {
    fetchMock.mockResolvedValueOnce({
      ok: (b.status ?? 200) < 400,
      status: b.status ?? 200,
      json: async () => b.json,
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("openbb provider", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("is disabled and never calls out when OPENBB_URL is unset", async () => {
    const obb = await load({ OPENBB_URL: "" });
    const fetchMock = mockFetch();
    expect(obb.enabled()).toBe(false);
    expect(obb.config()).toEqual({ enabled: false, provider: null });
    await expect(obb.quotes(["AAPL"])).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the provider-namespaced v5 route and maps quotes, de-normalizing percents", async () => {
    const obb = await load();
    const fetchMock = mockFetch({
      json: {
        results: [
          {
            symbol: "aapl",
            name: "Apple Inc.",
            last_price: 200,
            prev_close: 190,
            change: 10,
            change_percent: 0.0526,
            year_high: 250,
            year_low: 150,
            volume: 1000,
            exchange: "NMS",
            currency: "USD",
          },
          { symbol: "NOPE", last_price: null },
        ],
      },
    });
    const rows = await obb.quotes(["AAPL", "NOPE"]);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://openbb:6900/api/v1/yfinance/equity/price/quote?symbol=AAPL%2CNOPE"
    );
    expect(rows).toHaveLength(1); // the priceless row is dropped so the fallback chain picks it up
    expect(rows[0]).toMatchObject({
      symbol: "AAPL",
      price: 200,
      previousClose: 190,
      change: 10,
      week52High: 250,
      source: "openbb:yfinance",
    });
    expect(rows[0].changePercent).toBeCloseTo(5.26);
  });

  it("honours OPENBB_PROVIDER and basic auth", async () => {
    const obb = await load({
      OPENBB_URL: "http://x:6900",
      OPENBB_PROVIDER: "fmp",
      OPENBB_USERNAME: "u",
      OPENBB_PASSWORD: "p",
    });
    const fetchMock = mockFetch({ json: { results: [{ symbol: "MSFT", last_price: 1 }] } });
    await obb.quotes(["MSFT"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v1/fmp/equity/price/quote");
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from("u:p").toString("base64"));
  });

  it("surfaces OpenBB's error detail and treats empty results as failure", async () => {
    const obb = await load();
    mockFetch({ status: 502, json: { detail: "Error getting data for AAPL\nmore" } });
    await expect(obb.quotes(["AAPL"])).rejects.toThrow("openbb 502 equity/price/quote: Error getting data for AAPL");
    mockFetch({ json: { results: [] } });
    await expect(obb.history("AAPL", "6M")).rejects.toThrow(/no results/);
  });

  it("parses daily and intraday bars, sorts them, and keeps only the last session for 1D", async () => {
    const obb = await load();
    mockFetch({
      json: {
        results: [
          { date: "2026-10-20T09:35:00-04:00", open: 2, high: 3, low: 1, close: 2.5, volume: 10 },
          { date: "2026-10-17T15:55:00-04:00", open: 1, high: 1, low: 1, close: 1, volume: 5 },
          { date: "2026-10-20T09:30:00-04:00", open: 1, high: 2, low: 1, close: 2, volume: 7 },
        ],
      },
    });
    const intraday = await obb.history("AAPL", "1D");
    expect(intraday.map((c) => c.close)).toEqual([2, 2.5]);

    mockFetch({ json: { results: [{ date: "2026-10-01", open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 }] } });
    const daily = await obb.history("AAPL", "6M");
    expect(daily).toEqual([
      { time: Date.UTC(2026, 9, 1) / 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 },
    ]);
  });

  it("maps range keys to start dates and intervals", async () => {
    const obb = await load();
    const now = Date.UTC(2026, 9, 20);
    expect(obb.rangeParams("YTD", now)).toEqual({ start_date: "2026-01-01", interval: "1d" });
    expect(obb.rangeParams("5Y", now).interval).toBe("1W");
    expect(obb.rangeParams("bogus", now)).toEqual(obb.rangeParams("6M", now));
  });

  it("builds fundamentals from metrics, tolerating a missing profile", async () => {
    const obb = await load();
    mockFetch(
      {
        json: {
          results: [
            { pe_ratio: 30, forward_pe: 25, profit_margin: 0.25, revenue_growth: 0.08, debt_to_equity: 1.5, beta: 1.2 },
          ],
        },
      },
      { status: 404, json: { detail: "not found" } }
    );
    const f = await obb.fundamentals("aapl");
    expect(f.symbol).toBe("AAPL");
    expect(f.name).toBeNull();
    expect(f.valuation.pe).toBe(30);
    expect(f.profitability.profitMargin).toBeCloseTo(25);
    expect(f.growth.revenueGrowth).toBeCloseTo(8);
    expect(f.health.debtToEquity).toBe(1.5);
    expect(f.risk.beta).toBe(1.2);
  });
});
