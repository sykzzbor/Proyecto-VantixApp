import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  activeAppointmentSettingsSchema,
  appointmentSettingsSchema,
  createDefaultAppointmentSettings,
  type AppointmentSettingsInput,
} from "@/lib/validations/appointment-settings";

export type StoredAppointmentSettings = {
  enabled: boolean;
  timeZone: string;
  defaultDurationMinutes: number;
  bufferMinutes: number;
  minimumNoticeMinutes: number;
  maxAdvanceDays: number;
  weeklySchedule: unknown;
  location: string | null;
  defaultEventTitle: string;
  allowRescheduling: boolean;
  allowCancellation: boolean;
};

type CalendarState = {
  status: "CONNECTED" | "ERROR";
  selectedCalendarId: string | null;
} | null;

export type AppointmentSettingsStatus =
  | "MISSING_GOOGLE"
  | "MISSING_CALENDAR"
  | "INCOMPLETE"
  | "DISABLED"
  | "READY"
  | "ERROR";

export type AppointmentSettingsView = {
  settings: AppointmentSettingsInput;
  status: AppointmentSettingsStatus;
  prerequisites: {
    googleConnected: boolean;
    calendarSelected: boolean;
  };
};

export class AppointmentSettingsError extends Error {
  constructor(
    readonly code:
      | "google_not_connected"
      | "calendar_not_selected"
      | "configuration_incomplete",
    readonly safeMessage: string
  ) {
    super(safeMessage);
    this.name = "AppointmentSettingsError";
  }
}

export type AppointmentSettingsDependencies = {
  read: (organizationId: string) => Promise<{
    stored: StoredAppointmentSettings | null;
    calendar: CalendarState;
  }>;
  save: (input: {
    organizationId: string;
    userId: string;
    settings: AppointmentSettingsInput;
  }) => Promise<void>;
};

const defaultDependencies: AppointmentSettingsDependencies = {
  read: async (organizationId) => {
    const [stored, calendar] = await Promise.all([
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
    return { stored, calendar };
  },
  save: async ({ organizationId, userId, settings }) => {
    await prisma.$transaction(async (tx) => {
      await tx.appointmentSettings.upsert({
        where: { organizationId },
        create: {
          organizationId,
          ...settings,
          weeklySchedule: settings.weeklySchedule as Prisma.InputJsonValue,
          location: settings.location || null,
        },
        update: {
          ...settings,
          weeklySchedule: settings.weeklySchedule as Prisma.InputJsonValue,
          location: settings.location || null,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: "integraciones.google_calendar_turnos_actualizados",
          entityType: "appointment_settings",
          details: {
            enabled: settings.enabled,
            timeZone: settings.timeZone,
            defaultDurationMinutes: settings.defaultDurationMinutes,
            bufferMinutes: settings.bufferMinutes,
            minimumNoticeMinutes: settings.minimumNoticeMinutes,
            maxAdvanceDays: settings.maxAdvanceDays,
            enabledDays: settings.weeklySchedule
              .filter((day) => day.enabled)
              .map((day) => day.day),
            configuredRangeCount: settings.weeklySchedule.reduce(
              (total, day) => total + day.ranges.length,
              0
            ),
            allowRescheduling: settings.allowRescheduling,
            allowCancellation: settings.allowCancellation,
          },
        },
      });
    });
  },
};

function parseStoredSettings(stored: StoredAppointmentSettings): AppointmentSettingsInput {
  return appointmentSettingsSchema.parse({
    ...stored,
    location: stored.location ?? "",
  });
}

function buildView(
  stored: StoredAppointmentSettings | null,
  calendar: CalendarState
): AppointmentSettingsView {
  const googleConnected = calendar?.status === "CONNECTED";
  const calendarSelected = googleConnected && Boolean(calendar.selectedCalendarId);
  let settings = createDefaultAppointmentSettings();
  let valid = true;
  if (stored) {
    const parsed = appointmentSettingsSchema.safeParse({
      ...stored,
      location: stored.location ?? "",
    });
    if (parsed.success) settings = parsed.data;
    else valid = false;
  }

  const complete = valid && activeAppointmentSettingsSchema.safeParse(settings).success;
  const status: AppointmentSettingsStatus = !valid || calendar?.status === "ERROR"
    ? "ERROR"
    : !googleConnected
      ? "MISSING_GOOGLE"
      : !calendarSelected
        ? "MISSING_CALENDAR"
        : !complete
          ? "INCOMPLETE"
          : !settings.enabled
            ? "DISABLED"
            : "READY";

  return {
    settings,
    status,
    prerequisites: { googleConnected, calendarSelected },
  };
}

export async function getAppointmentSettings(
  organizationId: string,
  dependencies: AppointmentSettingsDependencies = defaultDependencies
): Promise<AppointmentSettingsView> {
  const snapshot = await dependencies.read(organizationId);
  return buildView(snapshot.stored, snapshot.calendar);
}

export async function updateAppointmentSettings(
  input: {
    organizationId: string;
    userId: string;
    settings: AppointmentSettingsInput;
  },
  dependencies: AppointmentSettingsDependencies = defaultDependencies
): Promise<AppointmentSettingsView> {
  const settings = appointmentSettingsSchema.parse(input.settings);
  const snapshot = await dependencies.read(input.organizationId);

  if (settings.enabled) {
    const complete = activeAppointmentSettingsSchema.safeParse(settings);
    if (!complete.success) {
      throw new AppointmentSettingsError(
        "configuration_incomplete",
        complete.error.issues[0]?.message ?? "Completá días y horarios antes de activar reservas."
      );
    }
    if (snapshot.calendar?.status !== "CONNECTED") {
      throw new AppointmentSettingsError(
        "google_not_connected",
        "Conectá Google Calendar antes de activar reservas."
      );
    }
    if (!snapshot.calendar.selectedCalendarId) {
      throw new AppointmentSettingsError(
        "calendar_not_selected",
        "Elegí un calendario antes de activar reservas."
      );
    }
  }

  await dependencies.save({ ...input, settings });
  return buildView(
    {
      ...settings,
      location: settings.location || null,
    },
    snapshot.calendar
  );
}

export function parseAppointmentSettingsRecord(
  stored: StoredAppointmentSettings
): AppointmentSettingsInput {
  return parseStoredSettings(stored);
}
