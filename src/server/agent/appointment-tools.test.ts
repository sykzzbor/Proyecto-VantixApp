import assert from "node:assert/strict";
import { test } from "node:test";
import { AppointmentError } from "@/server/appointments/service";
import {
  APPOINTMENT_TOOL_DEFINITIONS,
  runCancelAppointment,
  runCheckAvailability,
  runCreateAppointment,
  runRescheduleAppointment,
  type AppointmentToolDependencies,
} from "@/server/agent/appointment-tools";
import type { AgentToolContext } from "@/server/agent/tools";

const NOW = new Date("2026-07-20T12:00:00.000Z");
const SECRET_EVENT_ID = "google-event-secreto-123";
const SECRET_CALENDAR = "calendario-privado@group.calendar.google.com";

function ctx(): AgentToolContext {
  return {
    organizationId: "org-a",
    conversationId: "conversation-a",
    sourceMessageId: "message-confirmation-a",
    userId: null,
    flags: { humanTakeover: false },
  };
}

function slot(dateTime: string) {
  const [date, time] = dateTime.split(" ");
  return {
    startUtc: `${date}T${time}:00.000Z`,
    endUtc: `${date}T${time}:00.000Z`,
    startLocal: `${date}T${time}`,
    endLocal: `${date}T${time}`,
    timeZone: "America/Argentina/Buenos_Aires",
  };
}

function view(overrides: Record<string, unknown> = {}) {
  return {
    id: "appointment-1",
    customerId: "customer-1",
    conversationId: "conversation-a",
    startAt: "2026-07-21T13:00:00.000Z",
    endAt: "2026-07-21T13:30:00.000Z",
    timezone: "America/Argentina/Buenos_Aires",
    status: "CONFIRMED" as const,
    title: "Turno",
    customerName: "Ana",
    customerPhone: null,
    notes: null,
    cancellationReason: null,
    source: "AI" as const,
    lastError: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function deps(
  overrides: Partial<AppointmentToolDependencies> = {}
): AppointmentToolDependencies {
  return {
    readiness: async () => ({
      status: "READY",
      message: "ok",
      ready: true,
      allowRescheduling: true,
      allowCancellation: true,
      durationMinutes: 30,
      timeZone: "America/Argentina/Buenos_Aires",
    }),
    availability: async () => ({
      timeZone: "America/Argentina/Buenos_Aires",
      durationMinutes: 30,
      slots: [slot("2026-07-21 10:00"), slot("2026-07-21 11:00")],
    }),
    create: async () => {
      throw new Error("create no debía llamarse");
    },
    reschedule: async () => {
      throw new Error("reschedule no debía llamarse");
    },
    cancel: async () => {
      throw new Error("cancel no debía llamarse");
    },
    getConversationCustomer: async () => ({
      customerId: "customer-1",
      phone: "+5493515550000",
    }),
    confirmedByCustomer: async () => true,
    findCandidates: async () => [],
    now: () => NOW,
    ...overrides,
  };
}

test("check_appointment_availability consulta sin crear y devuelve pocos horarios", async () => {
  let created = 0;
  const result = await runCheckAvailability(
    ctx(),
    { date: "2026-07-21", days: null },
    deps({
      create: async () => {
        created += 1;
        return view();
      },
    })
  );
  const payload = result.payload as { horarios_disponibles: string[] };
  assert.deepEqual(payload.horarios_disponibles, [
    "2026-07-21 10:00 h",
    "2026-07-21 11:00 h",
  ]);
  assert.equal(created, 0);
});

test("fecha ambigua o inválida pide aclaración sin llamar servicios", async () => {
  const result = await runCheckAvailability(ctx(), { date: "mañana", days: null }, deps());
  assert.match(String((result.payload as { error: string }).error), /fecha concreta/i);
});

test("fecha imposible pide aclaración sin llamar servicios", async () => {
  const result = await runCheckAvailability(
    ctx(),
    { date: "2026-02-31", days: null },
    deps()
  );
  assert.match(String((result.payload as { error: string }).error), /fecha concreta/i);
});

test("create_appointment exige confirmación explícita", async () => {
  let created = 0;
  const result = await runCreateAppointment(
    ctx(),
    {
      customer_name: "Ana",
      date: "2026-07-21",
      time: "10:00",
      phone: null,
      notes: null,
      customer_confirmed: false,
    },
    deps({
      create: async () => {
        created += 1;
        return view();
      },
    })
  );
  assert.match(String((result.payload as { error: string }).error), /confirme/i);
  assert.equal(created, 0);
});

test("create_appointment valida la confirmación contra el mensaje real", async () => {
  let created = 0;
  const result = await runCreateAppointment(
    ctx(),
    {
      customer_name: "Ana",
      date: "2026-07-21",
      time: "10:00",
      phone: null,
      notes: null,
      customer_confirmed: true,
    },
    deps({
      confirmedByCustomer: async () => false,
      create: async () => {
        created += 1;
        return view();
      },
    })
  );
  assert.match(String((result.payload as { error: string }).error), /confirme/i);
  assert.equal(created, 0);
});

test("create_appointment rechaza IDs inyectados, HTML y teléfonos inválidos", async () => {
  let created = 0;
  const invalidInputs = [
    {
      customer_name: "Ana",
      date: "2026-07-21",
      time: "10:00",
      phone: null,
      notes: null,
      customer_confirmed: true,
      organizationId: "org-ajena",
    },
    {
      customer_name: "<b>Ana</b>",
      date: "2026-07-21",
      time: "10:00",
      phone: null,
      notes: null,
      customer_confirmed: true,
    },
    {
      customer_name: "Ana",
      date: "2026-07-21",
      time: "10:00",
      phone: "351-no-es-un-telefono",
      notes: null,
      customer_confirmed: true,
    },
  ];
  for (const input of invalidInputs) {
    const result = await runCreateAppointment(
      ctx(),
      input,
      deps({
        create: async () => {
          created += 1;
          return view();
        },
      })
    );
    assert.match(String((result.payload as { error: string }).error), /necesito/i);
  }
  assert.equal(created, 0);
});

test("create_appointment re-verifica el slot, usa source AI e idempotencia estable", async () => {
  const captured: Record<string, unknown>[] = [];
  const result = await runCreateAppointment(
    ctx(),
    {
      customer_name: "Ana",
      date: "2026-07-21",
      time: "10:00",
      phone: null,
      notes: null,
      customer_confirmed: true,
    },
    deps({
      create: async (input) => {
        captured.push(input as unknown as Record<string, unknown>);
        return view();
      },
    })
  );
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.source, "AI");
  assert.equal(captured[0]!.conversationId, "conversation-a");
  assert.equal(captured[0]!.organizationId, "org-a");
  const key = String(captured[0]!.idempotencyKey);
  assert.match(key, /^ai-conversation-a-/);
  assert.match(key, /^[A-Za-z0-9_-]+$/);
  const payload = result.payload as { ok: boolean; turno: Record<string, string> };
  assert.equal(payload.ok, true);
  // La respuesta al modelo nunca incluye IDs internos.
  const serialized = JSON.stringify(result.payload);
  assert.doesNotMatch(serialized, /appointment-1|conversation-a|org-a|calendar/i);
});

test("create_appointment conserva la misma clave ante un retry del mismo mensaje", async () => {
  const keys: string[] = [];
  const stable = deps({
    create: async (input) => {
      keys.push(input.idempotencyKey);
      return view();
    },
  });
  const args = {
    customer_name: "Ana",
    date: "2026-07-21",
    time: "10:00",
    phone: null,
    notes: null,
    customer_confirmed: true,
  };
  await runCreateAppointment(ctx(), args, stable);
  await runCreateAppointment(ctx(), args, stable);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("slot ocupado: no crea y ofrece alternativas reales", async () => {
  let created = 0;
  const result = await runCreateAppointment(
    ctx(),
    {
      customer_name: "Ana",
      date: "2026-07-21",
      time: "15:00",
      phone: null,
      notes: null,
      customer_confirmed: true,
    },
    deps({
      create: async () => {
        created += 1;
        return view();
      },
    })
  );
  const payload = result.payload as { error: string; alternativas: string[] };
  assert.match(payload.error, /no está disponible/i);
  assert.equal(payload.alternativas.length, 2);
  assert.equal(created, 0);
});

test("reprogramación: pide desambiguar cuando hay varios turnos", async () => {
  let rescheduled = 0;
  const candidates = [
    {
      id: "appt-1",
      startAt: new Date("2026-07-21T13:00:00.000Z"),
      timezone: "UTC",
      customerName: "Ana",
      status: "CONFIRMED",
    },
    {
      id: "appt-2",
      startAt: new Date("2026-07-21T16:00:00.000Z"),
      timezone: "UTC",
      customerName: "Ana",
      status: "CONFIRMED",
    },
  ];
  const result = await runRescheduleAppointment(
    ctx(),
    {
      current_date: "2026-07-21",
      current_time: null,
      new_date: "2026-07-21",
      new_time: "10:00",
      customer_confirmed: true,
    },
    deps({
      findCandidates: async () => candidates,
      reschedule: async () => {
        rescheduled += 1;
        return view();
      },
    })
  );
  const payload = result.payload as { error: string; turnos_posibles: string[] };
  assert.match(payload.error, /más de un turno/i);
  assert.equal(payload.turnos_posibles.length, 2);
  assert.equal(rescheduled, 0);
});

test("reprogramación feliz: opera solo sobre el turno del cliente", async () => {
  const captured: Record<string, unknown>[] = [];
  const result = await runRescheduleAppointment(
    ctx(),
    {
      current_date: "2026-07-21",
      current_time: "13:00",
      new_date: "2026-07-21",
      new_time: "11:00",
      customer_confirmed: true,
    },
    deps({
      findCandidates: async () => [
        {
          id: "appt-1",
          startAt: new Date("2026-07-21T13:00:00.000Z"),
          timezone: "UTC",
          customerName: "Ana",
          status: "CONFIRMED",
        },
      ],
      reschedule: async (input) => {
        captured.push(input as unknown as Record<string, unknown>);
        return view({ status: "RESCHEDULED" });
      },
    })
  );
  assert.equal(captured[0]!.appointmentId, "appt-1");
  assert.match(String(captured[0]!.idempotencyKey), /^ai-rs-appt-1-/);
  assert.equal((result.payload as { ok: boolean }).ok, true);
});

test("cancelación exige confirmación y turno propio; el ajeno no aparece", async () => {
  // findCandidates ya aísla por conversación/cliente: un turno de otra
  // organización u otro cliente nunca llega como candidato.
  let cancelled = 0;
  const noConfirm = await runCancelAppointment(
    ctx(),
    { date: "2026-07-21", time: null, reason: null, customer_confirmed: false },
    deps({
      cancel: async () => {
        cancelled += 1;
        return view({ status: "CANCELLED" });
      },
    })
  );
  assert.match(String((noConfirm.payload as { error: string }).error), /confirme/i);

  const foreign = await runCancelAppointment(
    ctx(),
    { date: "2026-07-21", time: null, reason: null, customer_confirmed: true },
    deps({ findCandidates: async () => [] })
  );
  assert.match(
    String((foreign.payload as { error: string }).error),
    /no encuentro un turno/i
  );
  assert.equal(cancelled, 0);
});

test("cancelación feliz con idempotencia", async () => {
  const captured: Record<string, unknown>[] = [];
  const result = await runCancelAppointment(
    ctx(),
    { date: "2026-07-21", time: "13:00", reason: "viaje", customer_confirmed: true },
    deps({
      findCandidates: async () => [
        {
          id: "appt-9",
          startAt: new Date("2026-07-21T13:00:00.000Z"),
          timezone: "UTC",
          customerName: "Ana",
          status: "CONFIRMED",
        },
      ],
      cancel: async (input) => {
        captured.push(input as unknown as Record<string, unknown>);
        return view({ status: "CANCELLED" });
      },
    })
  );
  assert.match(
    String(captured[0]!.idempotencyKey),
    /^ai-cx-appt-9-2026-07-21-message-confirmation-a$/
  );
  assert.equal(
    (result.payload as { turno: { estado: string } }).turno.estado,
    "cancelado"
  );
});

test("Google no configurado: mensaje humano y sin operar", async () => {
  let called = 0;
  const notReady = deps({
    readiness: async () => ({
      status: "GOOGLE_NOT_CONNECTED",
      message: "Conectá Google Calendar.",
      ready: false,
      allowRescheduling: false,
      allowCancellation: false,
      durationMinutes: null,
      timeZone: null,
    }),
    availability: async () => {
      called += 1;
      return { timeZone: "UTC", durationMinutes: 30, slots: [] };
    },
  });
  const cases: Array<[typeof runCheckAvailability, unknown]> = [
    [runCheckAvailability, { date: "2026-07-21", days: null }],
    [
      runCreateAppointment,
      {
        customer_name: "Ana",
        date: "2026-07-21",
        time: "10:00",
        phone: null,
        notes: null,
        customer_confirmed: true,
      },
    ],
  ];
  for (const [run, args] of cases) {
    const result = await run(ctx(), args, notReady);
    assert.match(
      String((result.payload as { error: string }).error),
      /no está disponible/i
    );
  }
  assert.equal(called, 0);
});

test("errores internos nunca exponen IDs, calendario ni detalles técnicos", async () => {
  const failing = deps({
    availability: async () => {
      throw new AppointmentError(
        "google_error",
        "No se pudo sincronizar con Google Calendar.",
        502,
        undefined
      );
    },
  });
  const result = await runCheckAvailability(
    ctx(),
    { date: "2026-07-21", days: null },
    failing
  );
  const serialized = JSON.stringify(result.payload);
  assert.doesNotMatch(serialized, new RegExp(SECRET_EVENT_ID));
  assert.doesNotMatch(serialized, new RegExp(SECRET_CALENDAR.replace(/[.@]/g, "\\$&")));
  assert.doesNotMatch(serialized, /google_error|502|stack/i);
  assert.match(serialized, /Google Calendar/);
});

test("las definiciones no permiten elegir organización, calendario ni IDs", () => {
  for (const definition of APPOINTMENT_TOOL_DEFINITIONS) {
    const keys = Object.keys(definition.inputSchema.properties);
    for (const forbidden of [
      "organizationId",
      "organization_id",
      "calendarId",
      "calendar_id",
      "appointmentId",
      "appointment_id",
      "googleEventId",
      "idempotencyKey",
    ]) {
      assert.equal(keys.includes(forbidden), false, `${definition.name}.${forbidden}`);
    }
  }
});
