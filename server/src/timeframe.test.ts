import { describe, expect, it } from "vitest";
import { parseInterval, pickBase, resample, lastSession } from "./timeframe.js";

const bar = (time: number, o: number, h: number, l: number, c: number, v = 1) => ({ time, open: o, high: h, low: l, close: c, volume: v });

describe("parseInterval", () => {
  it("parses common and custom timeframes", () => {
    expect(parseInterval("30s")?.seconds).toBe(30);
    expect(parseInterval("1m")?.seconds).toBe(60);
    expect(parseInterval("45m")?.seconds).toBe(2700);
    expect(parseInterval("4h")?.key).toBe("4h");
    expect(parseInterval("1d")?.key).toBe("1D");
    expect(parseInterval("2W")?.key).toBe("2W");
    expect(parseInterval("1M")?.unit).toBe("M");
  });
  it("rejects junk", () => {
    expect(parseInterval("")).toBeNull();
    expect(parseInterval("0m")).toBeNull();
    expect(parseInterval("5x")).toBeNull();
    expect(parseInterval("99999m")).toBeNull();
  });
});

describe("pickBase", () => {
  const natives = { minutes: [[1, "1m"], [5, "5m"], [15, "15m"], [60, "60m"]] as Array<[number, string]>, day: "1d", week: "1wk", month: "1mo" };
  it("picks the largest native size that divides the target", () => {
    expect(pickBase(parseInterval("45m")!, natives).base).toBe("15m");
    expect(pickBase(parseInterval("4h")!, natives).base).toBe("60m");
    expect(pickBase(parseInterval("7m")!, natives).base).toBe("1m");
    expect(pickBase(parseInterval("2W")!, natives).base).toBe("1wk");
    expect(pickBase(parseInterval("3D")!, natives).base).toBe("1d");
    const withSeconds = { ...natives, minutes: [[1 / 60, "1s"], ...natives.minutes] as Array<[number, string]> };
    expect(pickBase(parseInterval("30s")!, withSeconds).base).toBe("1s");
    expect(pickBase(parseInterval("5m")!, withSeconds).base).toBe("5m");
  });
});

describe("resample", () => {
  it("builds 1h bars aligned to the session open", () => {
    const open = Date.UTC(2026, 0, 5, 14, 30) / 1000; // 09:30 ET
    const bars = Array.from({ length: 12 }, (_, i) => bar(open + i * 900, 10 + i, 11 + i, 9 + i, 10.5 + i));
    const out = resample(bars, parseInterval("1h")!);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ time: open, open: 10, high: 14, low: 9, close: 13.5, volume: 4 });
    expect(out[1].time).toBe(open + 3600);
  });
  it("groups daily bars into calendar weeks and months", () => {
    const day = (y: number, m: number, d: number) => Date.UTC(y, m, d) / 1000;
    const bars = [day(2026, 0, 29), day(2026, 0, 30), day(2026, 1, 2), day(2026, 1, 3)].map((t, i) => bar(t, i, i + 1, i - 1, i));
    expect(resample(bars, parseInterval("1W")!).map((b) => b.time)).toEqual([day(2026, 0, 29), day(2026, 1, 2)]);
    expect(resample(bars, parseInterval("1M")!)).toHaveLength(2);
    expect(resample(bars, parseInterval("2D")!)).toHaveLength(2);
  });
  it("keeps only the last session", () => {
    const a = Date.UTC(2026, 0, 5, 15) / 1000;
    expect(lastSession([bar(a, 1, 1, 1, 1), bar(a + 86_400, 2, 2, 2, 2)])).toHaveLength(1);
  });
});
