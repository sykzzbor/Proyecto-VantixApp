import { isValidIanaTimeZone } from "@/lib/automation-schedule";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, created);
  return created;
}

export function formatLocalMinute(instant: Date, timeZone: string): string {
  const parts = formatter(timeZone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

/** Convierte una hora civil IANA a UTC usando ICU; rechaza gaps y horas ambiguas de DST. */
export function localMinuteToUtc(local: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(local);
  if (!match || !isValidIanaTimeZone(timeZone)) throw new Error("invalid_local_time");
  const [, year, month, day, hour, minute] = match;
  const guess = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const matches: Date[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 1) {
    const candidate = new Date(guess + offset * 60_000);
    if (formatLocalMinute(candidate, timeZone) === local) matches.push(candidate);
    if (matches.length > 1) break;
  }
  if (matches.length !== 1) throw new Error("ambiguous_or_invalid_local_time");
  return matches[0];
}
