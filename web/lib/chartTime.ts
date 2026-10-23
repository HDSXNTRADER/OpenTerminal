import { TickMarkType, type Time } from "lightweight-charts";

// lightweight-charts renders its time axis in UTC. Candles stay in UTC; only
// the labels are formatted in exchange time (New York) for intraday charts.
// Daily bars are stamped 00:00Z, so they keep UTC labels — in New York time
// they would land on the previous evening and show the wrong day.
const NY = "America/New_York";

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(locale: string, tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + tz + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: tz, hourCycle: "h23", ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

function toDate(time: Time): Date {
  if (typeof time === "number") return new Date(time * 1000);
  if (typeof time === "string") return new Date(time + "T12:00:00Z");
  return new Date(Date.UTC(time.year, time.month - 1, time.day, 12));
}

/** Chart options that label the time axis and crosshair in exchange time. */
export function exchangeTimeOptions(locale: string, intraday: boolean) {
  const tz = intraday ? NY : "UTC";
  return {
    localization: {
      locale,
      timeFormatter: (time: Time) =>
        fmt(
          locale,
          tz,
          intraday
            ? { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }
            : { day: "2-digit", month: "short", year: "2-digit" }
        ).format(toDate(time)),
    },
    tickMarkFormatter: (time: Time, type: TickMarkType) => {
      switch (type) {
        case TickMarkType.Year:
          return fmt(locale, tz, { year: "numeric" }).format(toDate(time));
        case TickMarkType.Month:
          return fmt(locale, tz, { month: "short" }).format(toDate(time));
        case TickMarkType.DayOfMonth:
          return fmt(locale, tz, { day: "2-digit", month: "short" }).format(toDate(time));
        case TickMarkType.TimeWithSeconds:
          return fmt(locale, tz, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(toDate(time));
        default:
          return fmt(locale, tz, { hour: "2-digit", minute: "2-digit" }).format(toDate(time));
      }
    },
  };
}
