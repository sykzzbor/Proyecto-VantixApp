import assert from "node:assert/strict";
import { test } from "node:test";
import { can } from "@/lib/permissions";
import {
  appointmentSettingsSchema,
  availabilityRequestSchema,
  createDefaultAppointmentSettings,
  type AppointmentSettingsInput,
} from "@/lib/validations/appointment-settings";
import {
  AppointmentAvailabilityError,
  calculateAvailableSlots,
  checkAppointmentAvailability,
  type AppointmentAvailabilityDependencies,
} from "@/server/appointments/availability";
import {
  getAppointmentSettings,
  updateAppointmentSettings,
  type AppointmentSettingsDependencies,
  type StoredAppointmentSettings,
} from "@/server/appointments/settings";
import {
  GoogleApiError,
  fetchCalendarFreeBusy,
} from "@/server/integrations/google-calendar/oauth";
import { PlanFeatureError } from "@/server/billing/rules";

const MONDAY = new Date("2026-07-20T08:00:00.000Z");

function validSettings(
  overrides: Partial<AppointmentSettingsInput> = {}
): AppointmentSettingsInput {
  const defaults = createDefaultAppointmentSettings();
  return {
    ...defaults,
    enabled: true,
    timeZone: "UTC",
    minimumNoticeMinutes: 0,
    maxAdvanceDays: 30,
    weeklySchedule: defaults.weeklySchedule.map((day) => ({
      day: day.day,
      enabled: day.day === 1,
      ranges: day.day === 1 ? [{ start: "09:00", end: "12:00" }] : [],
    })),
    ...overrides,
  };
}

function stored(settings: AppointmentSettingsInput): StoredAppointmentSettings {
  return {
    ...settings,
    weeklySchedule: settings.weeklySchedule,
    location: settings.location || null,
  };
}

function availabilityDependencies(input?: {
  settings?: AppointmentSettingsInput | null;
  calendar?: { status: "CONNECTED" | "ERROR"; selectedCalendarId: string | null } | null;
  busy?: { start: Date; end: Date }[];
  error?: Error;
  calls?: string[];
  planAccess?: boolean;
}): AppointmentAvailabilityDependencies {
  const settings = input?.settings === undefined ? validSettings() : input.settings;
  const calendar =
    input?.calendar === undefined
      ? { status: "CONNECTED" as const, selectedCalendarId: "calendar-safe" }
      : input.calendar;
  return {
    assertPlanAccess: async () => {
      if (input?.planAccess === false) {
        throw new PlanFeatureError("google_calendar");
      }
    },
    load: async (organizationId) => {
      input?.calls?.push(`load:${organizationId}`);
      return { settings: settings ? stored(settings) : null, calendar };
    },
    fetchBusy: async ({ organizationId, calendarId }) => {
      input?.calls?.push(`busy:${organizationId}:${calendarId}`);
      if (input?.error) throw input.error;
      return input?.busy ?? [];
    },
  };
}

test("configuración de turnos: OWNER/ADMIN editan y AGENT/VIEWER quedan en lectura", () => {
  assert.equal(can("OWNER", "appointments.settings.manage"), true);
  assert.equal(can("ADMIN", "appointments.settings.manage"), true);
  assert.equal(can("AGENT", "appointments.settings.manage"), false);
  assert.equal(can("VIEWER", "appointments.settings.manage"), false);
  for (const role of ["OWNER", "ADMIN", "AGENT", "VIEWER"] as const) {
    assert.equal(can(role, "appointments.view"), true);
  }
});

test("configuración: rechaza timezone, duración, HTML y rangos superpuestos", () => {
  assert.equal(
    appointmentSettingsSchema.safeParse(validSettings({ timeZone: "Mars/Olympus" })).success,
    false
  );
  assert.equal(
    appointmentSettingsSchema.safeParse(validSettings({ defaultDurationMinutes: 20 })).success,
    false
  );
  assert.equal(
    appointmentSettingsSchema.safeParse(validSettings({ defaultEventTitle: "<b>Turno</b>" })).success,
    false
  );
  const overlap = validSettings();
  overlap.weeklySchedule[0].ranges = [
    { start: "09:00", end: "11:00" },
    { start: "10:30", end: "12:00" },
  ];
  assert.equal(appointmentSettingsSchema.safeParse(overlap).success, false);
  assert.equal(
    appointmentSettingsSchema.safeParse({ ...validSettings(), organizationId: "org-ajena" }).success,
    false
  );
  assert.equal(
    availabilityRequestSchema.safeParse({
      from: MONDAY.toISOString(),
      to: new Date("2026-07-20T12:00:00.000Z").toISOString(),
      organizationId: "org-ajena",
    }).success,
    false
  );
});

test("configuración: defaults desactivados, lunes a viernes y horarios vacíos", () => {
  const defaults = createDefaultAppointmentSettings();
  assert.equal(defaults.enabled, false);
  assert.deepEqual(
    defaults.weeklySchedule.filter((day) => day.enabled).map((day) => day.day),
    [1, 2, 3, 4, 5]
  );
  assert.equal(defaults.weeklySchedule.every((day) => day.ranges.length === 0), true);
});

test("configuración: aislamiento por organización en lectura y escritura", async () => {
  const records = new Map<string, StoredAppointmentSettings>();
  const calls: string[] = [];
  const dependencies: AppointmentSettingsDependencies = {
    read: async (organizationId) => {
      calls.push(`read:${organizationId}`);
      return {
        stored: records.get(organizationId) ?? null,
        calendar: { status: "CONNECTED", selectedCalendarId: "calendar-safe" },
      };
    },
    save: async ({ organizationId, settings }) => {
      calls.push(`save:${organizationId}`);
      records.set(organizationId, stored(settings));
    },
  };
  const orgA = validSettings({ enabled: false, defaultEventTitle: "Turno A" });
  await updateAppointmentSettings(
    { organizationId: "org-a", userId: "user-a", settings: orgA },
    dependencies
  );
  const viewA = await getAppointmentSettings("org-a", dependencies);
  const viewB = await getAppointmentSettings("org-b", dependencies);
  assert.equal(viewA.settings.defaultEventTitle, "Turno A");
  assert.equal(viewB.settings.defaultEventTitle, "Turno");
  assert.deepEqual(calls, ["read:org-a", "save:org-a", "read:org-a", "read:org-b"]);
});

test("configuración: no activa reservas sin Google o calendario seleccionado", async () => {
  const settings = validSettings();
  const base: AppointmentSettingsDependencies = {
    read: async () => ({ stored: null, calendar: null }),
    save: async () => assert.fail("no debe guardar"),
  };
  await assert.rejects(
    updateAppointmentSettings(
      { organizationId: "org-a", userId: "user-a", settings },
      base
    ),
    /Conectá Google Calendar/
  );
  await assert.rejects(
    updateAppointmentSettings(
      { organizationId: "org-a", userId: "user-a", settings },
      {
        ...base,
        read: async () => ({
          stored: null,
          calendar: { status: "CONNECTED", selectedCalendarId: null },
        }),
      }
    ),
    /Elegí un calendario/
  );
});

test("disponibilidad: excluye días deshabilitados", () => {
  const slots = calculateAvailableSlots({
    settings: validSettings(),
    busy: [],
    from: new Date("2026-07-21T08:00:00.000Z"),
    to: new Date("2026-07-21T12:00:00.000Z"),
    now: new Date("2026-07-21T08:00:00.000Z"),
  });
  assert.equal(slots.length, 0);
});

test("disponibilidad: un rango completamente pasado devuelve vacío sin consultar Google", async () => {
  const calls: string[] = [];
  const result = await checkAppointmentAvailability(
    {
      organizationId: "org-a",
      request: {
        from: "2026-07-20T07:00:00.000Z",
        to: "2026-07-20T08:00:00.000Z",
      },
      now: new Date("2026-07-20T08:30:00.000Z"),
    },
    availabilityDependencies({ calls })
  );
  assert.deepEqual(result.slots, []);
  assert.deepEqual(calls, ["load:org-a"]);
});

test("disponibilidad: el plan sin Calendar falla cerrado antes de consultar datos", async () => {
  const calls: string[] = [];
  await assert.rejects(
    checkAppointmentAvailability(
      {
        organizationId: "org-trial",
        request: {
          from: "2026-07-20T09:00:00.000Z",
          to: "2026-07-20T12:00:00.000Z",
        },
        now: new Date("2026-07-20T08:00:00.000Z"),
      },
      availabilityDependencies({ calls, planAccess: false })
    ),
    (error) =>
      error instanceof AppointmentAvailabilityError &&
      error.code === "plan_required" &&
      error.status === 402
  );
  assert.deepEqual(calls, []);
});

test("disponibilidad: respeta anticipación mínima", () => {
  const slots = calculateAvailableSlots({
    settings: validSettings({ minimumNoticeMinutes: 60 }),
    busy: [],
    from: MONDAY,
    to: new Date("2026-07-20T12:00:00.000Z"),
    now: new Date("2026-07-20T08:30:00.000Z"),
  });
  assert.equal(slots[0]?.startUtc, "2026-07-20T09:30:00.000Z");
});

test("disponibilidad: convierte con la zona IANA y conserva UTC", () => {
  const settings = validSettings({ timeZone: "America/Argentina/Cordoba" });
  settings.weeklySchedule[0].ranges = [{ start: "09:00", end: "10:00" }];
  const slots = calculateAvailableSlots({
    settings,
    busy: [],
    from: new Date("2026-07-20T11:00:00.000Z"),
    to: new Date("2026-07-20T14:00:00.000Z"),
    now: new Date("2026-07-20T11:00:00.000Z"),
  });
  assert.equal(slots[0]?.startUtc, "2026-07-20T12:00:00.000Z");
  assert.equal(slots[0]?.startLocal, "2026-07-20T09:00:00");
  assert.equal(slots[0]?.timeZone, "America/Argentina/Cordoba");
});

test("disponibilidad: aplica descanso entre turnos", () => {
  const slots = calculateAvailableSlots({
    settings: validSettings({ bufferMinutes: 15 }),
    busy: [],
    from: MONDAY,
    to: new Date("2026-07-20T12:00:00.000Z"),
    now: MONDAY,
  });
  assert.deepEqual(
    slots.map((slot) => slot.startLocal.slice(11, 16)),
    ["09:00", "09:45", "10:30", "11:15"]
  );
});

test("disponibilidad: excluye evento ocupado y conserva slots libres", () => {
  const slots = calculateAvailableSlots({
    settings: validSettings(),
    busy: [
      {
        start: new Date("2026-07-20T09:30:00.000Z"),
        end: new Date("2026-07-20T10:00:00.000Z"),
      },
    ],
    from: MONDAY,
    to: new Date("2026-07-20T11:00:00.000Z"),
    now: MONDAY,
  });
  assert.deepEqual(
    slots.map((slot) => slot.startUtc),
    [
      "2026-07-20T09:00:00.000Z",
      "2026-07-20T10:00:00.000Z",
      "2026-07-20T10:30:00.000Z",
    ]
  );
  assert.equal(slots[0]?.startLocal, "2026-07-20T09:00:00");
});

test("disponibilidad: rechaza calendario desconectado y rango excesivo", async () => {
  await assert.rejects(
    checkAppointmentAvailability(
      {
        organizationId: "org-a",
        request: {
          from: MONDAY.toISOString(),
          to: new Date(MONDAY.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        },
        now: MONDAY,
      },
      availabilityDependencies({ calendar: null })
    ),
    (error) =>
      error instanceof AppointmentAvailabilityError &&
      error.code === "calendar_not_connected"
  );
  await assert.rejects(
    checkAppointmentAvailability(
      {
        organizationId: "org-a",
        request: {
          from: MONDAY.toISOString(),
          to: new Date(MONDAY.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString(),
        },
        now: MONDAY,
      },
      availabilityDependencies()
    ),
    (error) =>
      error instanceof AppointmentAvailabilityError && error.code === "range_too_large"
  );
});

test("disponibilidad: falla cerrado y sanitiza un error de Google", async () => {
  const privateDetail = "refresh-token-private-value";
  await assert.rejects(
    checkAppointmentAvailability(
      {
        organizationId: "org-a",
        request: {
          from: MONDAY.toISOString(),
          to: new Date("2026-07-20T12:00:00.000Z").toISOString(),
        },
        now: MONDAY,
      },
      availabilityDependencies({
        error: new GoogleApiError("network_error", privateDetail),
      })
    ),
    (error) =>
      error instanceof AppointmentAvailabilityError &&
      error.code === "google_unavailable" &&
      !error.safeMessage.includes(privateDetail)
  );
});

test("disponibilidad: usa organización y calendario internos sin filtrar secretos", async () => {
  const calls: string[] = [];
  const result = await checkAppointmentAvailability(
    {
      organizationId: "org-segura",
      request: {
        from: MONDAY.toISOString(),
        to: new Date("2026-07-20T12:00:00.000Z").toISOString(),
      },
      now: MONDAY,
    },
    availabilityDependencies({ calls })
  );
  assert.deepEqual(calls, ["load:org-segura", "busy:org-segura:calendar-safe"]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /token|secret|calendar-safe|org-segura/i);
  assert.ok(result.slots.length > 0);
});

test("FreeBusy usa POST oficial y devuelve solo intervalos normalizados", async () => {
  let authorization = "";
  let body = "";
  const intervals = await fetchCalendarFreeBusy(
    {
      accessToken: "unit-access-token-private-0001",
      calendarId: "calendar-safe",
      timeMin: new Date("2026-07-20T08:00:00.000Z"),
      timeMax: new Date("2026-07-20T12:00:00.000Z"),
      timeZone: "UTC",
    },
    (async (_url: RequestInfo | URL, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      body = String(init?.body);
      return Response.json({
        calendars: {
          "calendar-safe": {
            busy: [
              {
                start: "2026-07-20T09:00:00.000Z",
                end: "2026-07-20T09:30:00.000Z",
              },
            ],
          },
        },
      });
    }) as typeof fetch
  );
  assert.match(authorization, /^Bearer /);
  assert.match(body, /"items":\[\{"id":"calendar-safe"\}\]/);
  assert.equal(intervals[0]?.start.toISOString(), "2026-07-20T09:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(intervals), /unit-access-token-private/);
});
