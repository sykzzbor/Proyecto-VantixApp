import { prisma } from "@/lib/prisma";
import {
  activeAppointmentSettingsSchema,
  availabilityRequestSchema,
  type AppointmentSettingsInput,
  type AvailabilityRequest,
} from "@/lib/validations/appointment-settings";
import {
  GoogleApiError,
  fetchCalendarFreeBusy,
  type GoogleBusyInterval,
} from "@/server/integrations/google-calendar/oauth";
import { getValidAccessToken } from "@/server/integrations/google-calendar/service";
import {
  parseAppointmentSettingsRecord,
  type StoredAppointmentSettings,
} from "@/server/appointments/settings";
import { SubscriptionRequiredError } from "@/server/billing/entitlement";
import { PlanFeatureError, requirePlanFeature } from "@/server/billing/rules";

export const MAX_AVAILABILITY_RANGE_DAYS = 14;
const MAX_RETURNED_SLOTS = 500;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const WEEKDAY_NUMBER: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

type ZonedParts = {
  year: number;
  month: number;
  dayOfMonth: number;
  weekday: number;
  hour: number;
  minute: number;
};

export type AppointmentAvailabilitySlot = {
  startUtc: string;
  endUtc: string;
  startLocal: string;
  endLocal: string;
  timeZone: string;
};

export type AppointmentAvailabilityResult = {
  timeZone: string;
  durationMinutes: number;
  slots: AppointmentAvailabilitySlot[];
};

export class AppointmentAvailabilityError extends Error {
  constructor(
    readonly code:
      | "inactive"
      | "configuration_incomplete"
      | "calendar_not_connected"
      | "calendar_not_selected"
      | "plan_required"
      | "invalid_range"
      | "range_too_large"
      | "google_unavailable",
    readonly safeMessage: string,
    readonly status: 402 | 409 | 422 | 502
  ) {
    super(safeMessage);
    this.name = "AppointmentAvailabilityError";
  }
}

type AvailabilitySnapshot = {
  settings: StoredAppointmentSettings | null;
  calendar: {
    status: "CONNECTED" | "ERROR";
    selectedCalendarId: string | null;
  } | null;
};

export type AppointmentAvailabilityDependencies = {
  assertPlanAccess: (organizationId: string) => Promise<void>;
  load: (organizationId: string) => Promise<AvailabilitySnapshot>;
  fetchBusy: (input: {
    organizationId: string;
    calendarId: string;
    timeMin: Date;
    timeMax: Date;
    timeZone: string;
  }) => Promise<GoogleBusyInterval[]>;
};

const defaultDependencies: AppointmentAvailabilityDependencies = {
  assertPlanAccess: async (organizationId) => {
    await requirePlanFeature(organizationId, "google_calendar");
  },
  load: async (organizationId) => {
    const [settings, calendar] = await Promise.all([
      prisma.appointmentSettings.findUnique({
        where: { organizationId },
        select: {
          enabled: true,
          timeZone: true,
          defaultDurationMinutes: true,
          bufferMinutes: true,
          minimumNoticeMinutes: true,
          maxAdvanceDays: true,
          weeklySchedule: true,
          location: true,
          defaultEventTitle: true,
          allowRescheduling: true,
          allowCancellation: true,
        },
      }),
      prisma.googleCalendarConnection.findUnique({
        where: { organizationId },
        select: { status: true, selectedCalendarId: true },
      }),
    ]);
    return { settings, calendar };
  },
  fetchBusy: async (input) => {
    const accessToken = await getValidAccessToken(input.organizationId);
    return fetchCalendarFreeBusy({ accessToken, ...input });
  },
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, created);
  return created;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = zonedFormatter(timeZone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const result = {
    year: Number(value("year")),
    month: Number(value("month")),
    dayOfMonth: Number(value("day")),
    weekday: WEEKDAY_NUMBER[value("weekday") ?? ""],
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
  if (Object.values(result).some((item) => !Number.isInteger(item) || item < 0)) {
    throw new AppointmentAvailabilityError(
      "configuration_incomplete",
      "La zona horaria configurada no se pudo interpretar.",
      422
    );
  }
  return result;
}

function minuteOfDay(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function localDateKey(parts: ZonedParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.dayOfMonth).padStart(2, "0")}`;
}

function localDateTime(parts: ZonedParts): string {
  return `${localDateKey(parts)}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:00`;
}

function overlapsBusy(
  start: Date,
  end: Date,
  bufferMinutes: number,
  busy: GoogleBusyInterval[]
): boolean {
  const bufferMs = bufferMinutes * MINUTE_MS;
  return busy.some((interval) => {
    const busyStart = interval.start.getTime();
    const busyEnd = interval.end.getTime();
    if (!Number.isFinite(busyStart) || !Number.isFinite(busyEnd) || busyEnd <= busyStart) {
      return true;
    }
    return start.getTime() < busyEnd + bufferMs && end.getTime() + bufferMs > busyStart;
  });
}

/** Cálculo puro: no consulta Google ni conoce tokens. */
export function calculateAvailableSlots(input: {
  settings: AppointmentSettingsInput;
  busy: GoogleBusyInterval[];
  from: Date;
  to: Date;
  now: Date;
}): AppointmentAvailabilitySlot[] {
  const settings = activeAppointmentSettingsSchema.parse(input.settings);
  if (!settings.enabled) return [];
  const noticeStart = input.now.getTime() + settings.minimumNoticeMinutes * MINUTE_MS;
  const maximumStart = input.now.getTime() + settings.maxAdvanceDays * DAY_MS;
  const lowerBound = Math.max(input.from.getTime(), noticeStart, input.now.getTime());
  const upperBound = Math.min(input.to.getTime(), maximumStart);
  if (lowerBound >= upperBound) return [];

  const durationMs = settings.defaultDurationMinutes * MINUTE_MS;
  const cadenceMinutes = settings.defaultDurationMinutes + settings.bufferMinutes;
  const byDay = new Map(settings.weeklySchedule.map((day) => [day.day, day]));
  const slots: AppointmentAvailabilitySlot[] = [];
  const localStarts = new Set<string>();
  let candidateMs = Math.ceil(lowerBound / MINUTE_MS) * MINUTE_MS;

  for (; candidateMs + durationMs <= upperBound; candidateMs += MINUTE_MS) {
    const start = new Date(candidateMs);
    const end = new Date(candidateMs + durationMs);
    const localStart = zonedParts(start, settings.timeZone);
    const localEnd = zonedParts(end, settings.timeZone);
    const day = byDay.get(localStart.weekday);
    if (!day?.enabled || day.ranges.length === 0) continue;
    if (localDateKey(localStart) !== localDateKey(localEnd)) continue;

    const startMinute = localStart.hour * 60 + localStart.minute;
    const endMinute = localEnd.hour * 60 + localEnd.minute;
    if (endMinute - startMinute !== settings.defaultDurationMinutes) continue;
    const matchesRange = day.ranges.some((range) => {
      const rangeStart = minuteOfDay(range.start);
      const rangeEnd = minuteOfDay(range.end);
      return (
        startMinute >= rangeStart &&
        endMinute <= rangeEnd &&
        (startMinute - rangeStart) % cadenceMinutes === 0
      );
    });
    if (!matchesRange || overlapsBusy(start, end, settings.bufferMinutes, input.busy)) {
      continue;
    }

    const startLocal = localDateTime(localStart);
    if (localStarts.has(startLocal)) continue;
    localStarts.add(startLocal);
    slots.push({
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
      startLocal,
      endLocal: localDateTime(localEnd),
      timeZone: settings.timeZone,
    });
    if (slots.length >= MAX_RETURNED_SLOTS) break;
  }
  return slots;
}

export async function checkAppointmentAvailability(
  input: {
    organizationId: string;
    request: AvailabilityRequest;
    now?: Date;
  },
  dependencies: AppointmentAvailabilityDependencies = defaultDependencies
): Promise<AppointmentAvailabilityResult> {
  const request = availabilityRequestSchema.parse(input.request);
  const from = new Date(request.from);
  const to = new Date(request.to);
  const now = input.now ?? new Date();
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new AppointmentAvailabilityError("invalid_range", "El rango solicitado no es válido.", 422);
  }
  if (to.getTime() - from.getTime() > MAX_AVAILABILITY_RANGE_DAYS * DAY_MS) {
    throw new AppointmentAvailabilityError(
      "range_too_large",
      `Consultá como máximo ${MAX_AVAILABILITY_RANGE_DAYS} días por vez.`,
      422
    );
  }

  try {
    await dependencies.assertPlanAccess(input.organizationId);
  } catch (error) {
    if (
      error instanceof PlanFeatureError ||
      error instanceof SubscriptionRequiredError
    ) {
      throw new AppointmentAvailabilityError(
        "plan_required",
        "Google Calendar está disponible desde el plan Standard.",
        402
      );
    }
    throw error;
  }

  const snapshot = await dependencies.load(input.organizationId);
  if (!snapshot.settings?.enabled) {
    throw new AppointmentAvailabilityError(
      "inactive",
      "Las reservas todavía no están activas.",
      409
    );
  }
  let settings: AppointmentSettingsInput;
  try {
    settings = parseAppointmentSettingsRecord(snapshot.settings);
    const complete = activeAppointmentSettingsSchema.safeParse(settings);
    if (!complete.success) throw new Error("incomplete");
  } catch {
    throw new AppointmentAvailabilityError(
      "configuration_incomplete",
      "La configuración de turnos está incompleta.",
      409
    );
  }
  if (snapshot.calendar?.status !== "CONNECTED") {
    throw new AppointmentAvailabilityError(
      "calendar_not_connected",
      "Google Calendar no está conectado.",
      409
    );
  }
  if (!snapshot.calendar.selectedCalendarId) {
    throw new AppointmentAvailabilityError(
      "calendar_not_selected",
      "No hay un calendario seleccionado.",
      409
    );
  }
  const maximum = now.getTime() + settings.maxAdvanceDays * DAY_MS;
  if (from.getTime() > maximum || to.getTime() > maximum + MINUTE_MS) {
    throw new AppointmentAvailabilityError(
      "range_too_large",
      "El rango supera el máximo futuro configurado.",
      422
    );
  }

  const effectiveMin = Math.max(
    from.getTime(),
    now.getTime() + settings.minimumNoticeMinutes * MINUTE_MS
  );
  const effectiveMax = Math.min(to.getTime(), maximum);
  if (effectiveMin >= effectiveMax) {
    return {
      timeZone: settings.timeZone,
      durationMinutes: settings.defaultDurationMinutes,
      slots: [],
    };
  }
  // FreeBusy debe cubrir también el descanso anterior y posterior al rango.
  const bufferMs = settings.bufferMinutes * MINUTE_MS;
  const timeMin = new Date(effectiveMin - bufferMs);
  const timeMax = new Date(effectiveMax + bufferMs);
  let busy: GoogleBusyInterval[];
  try {
    busy = await dependencies.fetchBusy({
      organizationId: input.organizationId,
      calendarId: snapshot.calendar.selectedCalendarId,
      timeMin,
      timeMax,
      timeZone: settings.timeZone,
    });
  } catch (error) {
    const safe =
      error instanceof GoogleApiError
        ? "Google Calendar no pudo confirmar la disponibilidad."
        : "No se pudo consultar la disponibilidad.";
    throw new AppointmentAvailabilityError("google_unavailable", safe, 502);
  }

  return {
    timeZone: settings.timeZone,
    durationMinutes: settings.defaultDurationMinutes,
    slots: calculateAvailableSlots({ settings, busy, from, to, now }),
  };
}
