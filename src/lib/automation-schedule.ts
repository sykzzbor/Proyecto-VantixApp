export type AutomationSchedule = {
  timeZone: string;
  enabledDays: number[];
  startTime: string;
  endTime: string;
};

type ZonedParts = {
  weekday: number;
  hour: number;
  minute: number;
};

const WEEKDAY_NUMBER: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, created);
  return created;
}

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone).format(new Date(0));
    return timeZone.includes("/") || timeZone === "UTC";
  } catch {
    return false;
  }
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const weekday = WEEKDAY_NUMBER[value("weekday") ?? ""];
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  if (!weekday || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error("invalid_zoned_time");
  }
  return { weekday, hour, minute };
}

function minuteOfDay(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error("invalid_local_time");
  }
  return hour * 60 + minute;
}

function previousWeekday(weekday: number) {
  return weekday === 1 ? 7 : weekday - 1;
}

/**
 * Evalúa el horario usando ICU/Intl y la base IANA del runtime. Para ventanas
 * que cruzan medianoche, las horas posteriores a las 00:00 pertenecen al día
 * en el que comenzó la ventana.
 */
export function isAutomationTimeAllowed(
  instant: Date,
  schedule: AutomationSchedule
): boolean {
  if (!isValidIanaTimeZone(schedule.timeZone)) return false;
  const start = minuteOfDay(schedule.startTime);
  const end = minuteOfDay(schedule.endTime);
  if (start === end || schedule.enabledDays.length === 0) return false;

  const local = zonedParts(instant, schedule.timeZone);
  const currentMinute = local.hour * 60 + local.minute;
  const enabled = new Set(schedule.enabledDays);

  if (start < end) {
    return (
      enabled.has(local.weekday) &&
      currentMinute >= start &&
      currentMinute < end
    );
  }

  return currentMinute >= start
    ? enabled.has(local.weekday)
    : currentMinute < end && enabled.has(previousWeekday(local.weekday));
}

/**
 * Devuelve el primer instante UTC permitido, sin asumir la zona del servidor.
 * El barrido por minutos delega offsets, medianoche y DST a Intl/ICU; como la
 * configuración exige al menos un día, ocho días cubren el próximo horario.
 */
export function nextAutomationTimeAllowed(
  from: Date,
  schedule: AutomationSchedule
): Date {
  if (!isValidIanaTimeZone(schedule.timeZone)) {
    throw new Error("invalid_time_zone");
  }
  if (isAutomationTimeAllowed(from, schedule)) return new Date(from);

  const candidate = new Date(from);
  candidate.setUTCSeconds(0, 0);
  if (candidate.getTime() < from.getTime()) {
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  const maxMinutes = 8 * 24 * 60;
  for (let offset = 0; offset <= maxMinutes; offset += 1) {
    if (isAutomationTimeAllowed(candidate, schedule)) return new Date(candidate);
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error("no_allowed_time_found");
}

export function scheduleAutomationAfterHours(
  sourceInstant: Date,
  delayHours: number,
  schedule: AutomationSchedule
): Date {
  const due = new Date(sourceInstant.getTime() + delayHours * 60 * 60 * 1000);
  return nextAutomationTimeAllowed(due, schedule);
}
