import assert from "node:assert/strict";
import { test } from "node:test";
import { can } from "@/lib/permissions";
import { GOOGLE_CALENDAR_SCOPES } from "@/server/integrations/google-calendar/config";
import {
  GoogleApiError,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  updateGoogleCalendarEvent,
} from "@/server/integrations/google-calendar/oauth";
import {
  AppointmentError,
  cancelAppointment,
  createAppointment,
  getAppointment,
  getAppointmentReadiness,
  listAppointments,
  rescheduleAppointment,
  type AppointmentRecord,
  type AppointmentServiceDependencies,
} from "@/server/appointments/service";
import { createDefaultAppointmentSettings } from "@/lib/validations/appointment-settings";
import { createAppointmentSchema } from "@/lib/validations/appointments";
import { localMinuteToUtc } from "@/lib/time-zone";
import { PlanFeatureError } from "@/server/billing/rules";

const START = "2026-07-20T09:00:00.000Z";
const SECOND_START = "2026-07-20T10:00:00.000Z";

function settings() {
  const value = createDefaultAppointmentSettings();
  return {
    ...value,
    enabled: true,
    timeZone: "UTC",
    minimumNoticeMinutes: 0,
    allowRescheduling: true,
    allowCancellation: true,
    weeklySchedule: value.weeklySchedule.map((day) => ({
      ...day,
      enabled: day.day === 1,
      ranges: day.day === 1 ? [{ start: "09:00", end: "18:00" }] : [],
    })),
  };
}

function record(overrides: Partial<AppointmentRecord> = {}): AppointmentRecord {
  const createdAt = new Date("2026-07-19T12:00:00.000Z");
  return {
    id: "appointment-1",
    organizationId: "org-a",
    customerId: null,
    conversationId: null,
    googleEventId: "google-event-safe-1",
    calendarId: "calendar-safe",
    startAt: new Date(START),
    endAt: new Date("2026-07-20T09:30:00.000Z"),
    timezone: "UTC",
    status: "CONFIRMED",
    title: "Turno",
    customerName: "Cliente Seguro",
    customerPhone: "+5493511234567",
    notes: null,
    cancellationReason: null,
    createdByUserId: "user-a",
    source: "MANUAL",
    idempotencyKey: "create-key-1",
    lastOperationKey: null,
    lastError: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function memoryDependencies(options: {
  initial?: AppointmentRecord[];
  slotAvailable?: boolean;
  scopes?: string[];
  connectionStatus?: "CONNECTED" | "ERROR";
  createError?: Error;
  updateError?: Error;
  deleteError?: Error;
  referencesValid?: boolean;
  planAccess?: boolean;
} = {}) {
  const rows = options.initial ? [...options.initial] : [];
  const calls: string[] = [];
  let sequence = rows.length + 1;
  let tick = Date.parse("2026-07-19T12:00:00.000Z");
  const touch = (row: AppointmentRecord) => {
    tick += 1;
    row.updatedAt = new Date(tick);
    return row;
  };
  const dependencies: AppointmentServiceDependencies = {
    assertPlanAccess: async () => {
      if (options.planAccess === false) {
        throw new PlanFeatureError("google_calendar");
      }
    },
    loadPrerequisites: async () => ({
      settings: settings(),
      connection: {
        status: options.connectionStatus ?? "CONNECTED",
        selectedCalendarId: "calendar-safe",
        grantedScopes: options.scopes ?? [...GOOGLE_CALENDAR_SCOPES],
      },
    }),
    validateReferences: async () => options.referencesValid ?? true,
    checkSlot: async () => options.slotAvailable ?? true,
    findByIdempotency: async (organizationId, key) =>
      rows.find((row) => row.organizationId === organizationId && row.idempotencyKey === key) ?? null,
    createPending: async (input) => {
      const existing = rows.find(
        (row) => row.organizationId === input.organizationId && row.idempotencyKey === input.idempotencyKey
      );
      if (existing) return { record: existing, created: false };
      const row = record({
        ...input,
        id: `appointment-${sequence++}`,
        googleEventId: null,
        status: "PENDING",
        cancellationReason: null,
        lastOperationKey: null,
        lastError: null,
        createdAt: new Date(++tick),
        updatedAt: new Date(++tick),
      });
      rows.push(row);
      return { record: row, created: true };
    },
    findById: async (organizationId, id) =>
      rows.find((row) => row.organizationId === organizationId && row.id === id) ?? null,
    list: async (organizationId, query) =>
      rows
        .filter((row) => row.organizationId === organizationId && (!query.status || row.status === query.status))
        .slice(0, query.limit),
    claimOperation: async ({ organizationId, id, expectedUpdatedAt, operationKey }) => {
      const row = rows.find((item) => item.organizationId === organizationId && item.id === id);
      if (!row || row.updatedAt.getTime() !== expectedUpdatedAt.getTime() || row.status === "PENDING") return false;
      row.status = "PENDING";
      row.lastOperationKey = operationKey;
      row.lastError = null;
      touch(row);
      return true;
    },
    completeCreate: async ({ organizationId, id, eventId }) => {
      const row = rows.find((item) => item.organizationId === organizationId && item.id === id)!;
      row.googleEventId = eventId;
      row.status = "CONFIRMED";
      return touch(row);
    },
    completeReschedule: async ({ organizationId, id, operationKey, startAt, endAt }) => {
      const row = rows.find((item) => item.organizationId === organizationId && item.id === id)!;
      row.startAt = startAt;
      row.endAt = endAt;
      row.status = "RESCHEDULED";
      row.lastOperationKey = operationKey;
      return touch(row);
    },
    completeCancel: async ({ organizationId, id, operationKey, reason }) => {
      const row = rows.find((item) => item.organizationId === organizationId && item.id === id)!;
      row.status = "CANCELLED";
      row.lastOperationKey = operationKey;
      row.cancellationReason = reason;
      return touch(row);
    },
    fail: async ({ organizationId, id, operationKey, error }) => {
      const row = rows.find((item) => item.organizationId === organizationId && item.id === id)!;
      row.status = "FAILED";
      row.lastOperationKey = operationKey ?? null;
      row.lastError = error;
      return touch(row);
    },
    createRemote: async () => {
      calls.push("create");
      if (options.createError) throw options.createError;
      return "google-created-safe";
    },
    updateRemote: async () => {
      calls.push("update");
      if (options.updateError) throw options.updateError;
    },
    deleteRemote: async () => {
      calls.push("delete");
      if (options.deleteError) throw options.deleteError;
    },
    audit: async ({ action }) => {
      calls.push(`audit:${action}`);
    },
  };
  return { dependencies, rows, calls };
}

function createInput(key = "create-key-new") {
  return {
    organizationId: "org-a",
    createdByUserId: "user-a",
    source: "MANUAL" as const,
    startAt: START,
    customerName: "Cliente Seguro",
    customerPhone: "+5493511234567",
    notes: "Consulta inicial",
    idempotencyKey: key,
  };
}

test("permisos: OWNER/ADMIN/AGENT gestionan y VIEWER queda en lectura", () => {
  for (const role of ["OWNER", "ADMIN", "AGENT"] as const) {
    assert.equal(can(role, "appointments.manage"), true);
  }
  assert.equal(can("VIEWER", "appointments.manage"), false);
  assert.equal(can("VIEWER", "appointments.view"), true);
});

test("creación correcta confirma el turno y no devuelve identificadores de Google", async () => {
  const memory = memoryDependencies();
  const result = await createAppointment(createInput(), memory.dependencies);
  assert.equal(result.status, "CONFIRMED");
  assert.deepEqual(memory.calls, ["create", "audit:turnos.creado"]);
  assert.doesNotMatch(JSON.stringify(result), /googleEvent|calendar-safe|idempotency|token/i);
  assert.match(result.customerPhone ?? "", /••••/);
});

test("un slot ocupado falla cerrado antes de crear registros o llamar Google", async () => {
  const memory = memoryDependencies({ slotAvailable: false });
  await assert.rejects(
    createAppointment(createInput(), memory.dependencies),
    (error) => error instanceof AppointmentError && error.code === "slot_unavailable"
  );
  assert.equal(memory.rows.length, 0);
  assert.deepEqual(memory.calls, []);
});

test("un plan sin Google Calendar bloquea turnos y expone un estado seguro", async () => {
  const memory = memoryDependencies({ planAccess: false });
  await assert.rejects(
    createAppointment(createInput(), memory.dependencies),
    (error) =>
      error instanceof AppointmentError &&
      error.code === "plan_required" &&
      error.status === 402
  );
  const readiness = await getAppointmentReadiness("org-a", memory.dependencies);
  assert.equal(readiness.status, "PLAN_REQUIRED");
  assert.equal(readiness.ready, false);
  assert.doesNotMatch(JSON.stringify(readiness), /token|calendar-safe|google-event/i);
  assert.deepEqual(memory.calls, []);
  assert.deepEqual(memory.rows, []);
});

test("doble creación con la misma clave devuelve el mismo turno y llama Google una vez", async () => {
  const memory = memoryDependencies();
  const first = await createAppointment(createInput("same-key"), memory.dependencies);
  const second = await createAppointment(createInput("same-key"), memory.dependencies);
  assert.equal(first.id, second.id);
  assert.equal(memory.calls.filter((call) => call === "create").length, 1);
});

test("scope readonly y conexión vencida bloquean toda escritura", async () => {
  await assert.rejects(
    createAppointment(
      createInput(),
      memoryDependencies({ scopes: ["https://www.googleapis.com/auth/calendar.readonly"] }).dependencies
    ),
    (error) => error instanceof AppointmentError && error.code === "scope_insufficient"
  );
  await assert.rejects(
    createAppointment(createInput(), memoryDependencies({ connectionStatus: "ERROR" }).dependencies),
    (error) => error instanceof AppointmentError && error.code === "connection_expired"
  );
});

test("un error parcial de Google conserva el registro como FAILED y sanitizado", async () => {
  const privateValue = "token=private-value";
  const memory = memoryDependencies({
    createError: new GoogleApiError("google_unavailable", `falló ${privateValue}`),
  });
  await assert.rejects(
    createAppointment(createInput(), memory.dependencies),
    (error) =>
      error instanceof AppointmentError &&
      error.code === "google_error" &&
      error.appointment?.status === "FAILED" &&
      !error.safeMessage.includes("private-value")
  );
  assert.equal(memory.rows[0]?.status, "FAILED");
});

test("reprogramación correcta actualiza Google y conserva estado RESCHEDULED", async () => {
  const memory = memoryDependencies({ initial: [record()] });
  const result = await rescheduleAppointment(
    {
      organizationId: "org-a",
      appointmentId: "appointment-1",
      userId: "user-a",
      startAt: SECOND_START,
      idempotencyKey: "move-key-1",
    },
    memory.dependencies
  );
  assert.equal(result.status, "RESCHEDULED");
  assert.equal(result.startAt, SECOND_START);
  assert.equal(memory.calls.filter((call) => call === "update").length, 1);
});

test("reprogramar a un horario ocupado no modifica Google", async () => {
  const memory = memoryDependencies({ initial: [record()], slotAvailable: false });
  await assert.rejects(
    rescheduleAppointment(
      {
        organizationId: "org-a",
        appointmentId: "appointment-1",
        userId: "user-a",
        startAt: SECOND_START,
        idempotencyKey: "move-key-2",
      },
      memory.dependencies
    ),
    (error) => error instanceof AppointmentError && error.code === "slot_unavailable"
  );
  assert.equal(memory.calls.includes("update"), false);
});

test("doble reprogramación con la misma clave no repite la actualización remota", async () => {
  const memory = memoryDependencies({ initial: [record()] });
  const input = {
    organizationId: "org-a",
    appointmentId: "appointment-1",
    userId: "user-a",
    startAt: SECOND_START,
    idempotencyKey: "move-same-key",
  };
  await rescheduleAppointment(input, memory.dependencies);
  await rescheduleAppointment(input, memory.dependencies);
  assert.equal(memory.calls.filter((call) => call === "update").length, 1);
});

test("cancelación conserva el registro, motivo y estado CANCELLED", async () => {
  const memory = memoryDependencies({ initial: [record()] });
  const result = await cancelAppointment(
    {
      organizationId: "org-a",
      appointmentId: "appointment-1",
      userId: "user-a",
      reason: "El cliente avisó",
      idempotencyKey: "cancel-key-1",
    },
    memory.dependencies
  );
  assert.equal(result.status, "CANCELLED");
  assert.equal(result.cancellationReason, "El cliente avisó");
  assert.equal(memory.rows.length, 1);
});

test("doble cancelación es idempotente y elimina en Google una sola vez", async () => {
  const memory = memoryDependencies({ initial: [record()] });
  const input = {
    organizationId: "org-a",
    appointmentId: "appointment-1",
    userId: "user-a",
    reason: "Cancelado",
    idempotencyKey: "cancel-same-key",
  };
  await cancelAppointment(input, memory.dependencies);
  await cancelAppointment(input, memory.dependencies);
  assert.equal(memory.calls.filter((call) => call === "delete").length, 1);
});

test("un turno de otra organización no puede verse, listarse ni modificarse", async () => {
  const memory = memoryDependencies({ initial: [record()] });
  assert.equal(await getAppointment("org-b", "appointment-1", memory.dependencies), null);
  assert.deepEqual(await listAppointments("org-b", { limit: 50 }, memory.dependencies), []);
  await assert.rejects(
    rescheduleAppointment(
      {
        organizationId: "org-b",
        appointmentId: "appointment-1",
        userId: "user-b",
        startAt: SECOND_START,
        idempotencyKey: "foreign-key",
      },
      memory.dependencies
    ),
    (error) => error instanceof AppointmentError && error.code === "not_found"
  );
});

test("validación rechaza HTML, teléfono inválido y precisión sub-minuto", () => {
  assert.equal(createAppointmentSchema.safeParse({ ...createInput(), title: "<b>Turno</b>" }).success, false);
  assert.equal(createAppointmentSchema.safeParse({ ...createInput(), customerPhone: "351123" }).success, false);
  assert.equal(
    createAppointmentSchema.safeParse({ ...createInput(), startAt: "2026-07-20T09:00:30.000Z" }).success,
    false
  );
  assert.equal(
    createAppointmentSchema.safeParse({ ...createInput(), organizationId: "org-ajena" }).success,
    false
  );
});

test("conversión IANA produce UTC estable y rechaza una hora DST inexistente", () => {
  assert.equal(
    localMinuteToUtc("2026-07-20T09:00", "America/Argentina/Cordoba").toISOString(),
    "2026-07-20T12:00:00.000Z"
  );
  assert.throws(() => localMinuteToUtc("2026-03-08T02:30", "America/New_York"));
});

test("cliente Google usa POST/PATCH/DELETE sin filtrar el access token al body", async () => {
  const methods: string[] = [];
  const bodies: string[] = [];
  const fakeFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    methods.push(String(init?.method));
    bodies.push(String(init?.body ?? ""));
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ id: "google-event-safe-1" });
  }) as typeof fetch;
  const common = {
    accessToken: "private-access-token-0000000001",
    calendarId: "calendar-safe",
    startAt: new Date(START),
    endAt: new Date("2026-07-20T09:30:00.000Z"),
    timeZone: "UTC",
  };
  await createGoogleCalendarEvent({ ...common, title: "Turno" }, fakeFetch);
  await updateGoogleCalendarEvent({ ...common, eventId: "google-event-safe-1" }, fakeFetch);
  await deleteGoogleCalendarEvent(
    { accessToken: common.accessToken, calendarId: common.calendarId, eventId: "google-event-safe-1" },
    fakeFetch
  );
  assert.deepEqual(methods, ["POST", "PATCH", "DELETE"]);
  assert.doesNotMatch(bodies.join(" "), /private-access-token/);
});

test("eliminación remota repetida acepta 404 como éxito idempotente", async () => {
  const previousError = console.error;
  console.error = () => undefined;
  try {
    await deleteGoogleCalendarEvent(
      {
        accessToken: "private-access-token-0000000001",
        calendarId: "calendar-safe",
        eventId: "google-event-safe-1",
      },
      (async () => new Response(null, { status: 404 })) as typeof fetch
    );
  } finally {
    console.error = previousError;
  }
});
