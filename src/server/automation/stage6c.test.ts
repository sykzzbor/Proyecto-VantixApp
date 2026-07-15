import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAutomationTimeAllowed,
  isValidIanaTimeZone,
  nextAutomationTimeAllowed,
  scheduleAutomationAfterHours,
  type AutomationSchedule,
} from "@/lib/automation-schedule";
import { AUTOMATION_RULE_PERMISSIONS, can } from "@/lib/permissions";
import {
  DEFAULT_FOLLOW_UP_CONFIG,
  DEFAULT_HANDOFF_CONFIG,
  automationRuleUpdateSchema,
  followUpRuleConfigSchema,
  handoffRuleConfigSchema,
  parseAutomationRuleConfig,
  renderFollowUpMessage,
} from "@/lib/validations/automation-rules";
import {
  n8nCallbackSchema,
  n8nFollowUpActionSchema,
  signedTimestampMatches,
} from "@/lib/validations/automation-webhooks";
import {
  canExecuteN8nFollowUpAction,
  decideFollowUpEligibility,
  resolveExistingFollowUpAction,
  resolveStaleFollowUpAction,
  type FollowUpEligibilitySnapshot,
} from "@/server/automation/follow-up-action";
import {
  buildFollowUpCancellationScope,
  followUpIdempotencyKey,
} from "@/server/automation/follow-up";
import {
  handoffIdempotencyKey,
  resolveHandoffRecipients,
  resolveHandoffEventDispatchState,
  runHandoffWithFallback,
  type HandoffRecipient,
} from "@/server/automation/handoff";
import {
  isTimestampFresh,
  signAutomationBody,
  verifyAutomationSignature,
} from "@/server/automation/signature";
import { automationJson, readLimitedRawBody } from "@/server/automation/http";
import {
  canAcceptSuccessfulAutomationCallback,
  isCurrentAutomationCallback,
} from "@/server/automation/callback";
import { resolveStaleHandoffAction } from "@/server/automation/queue";

const VALID_FOLLOW_UP_CONFIG = {
  ...DEFAULT_FOLLOW_UP_CONFIG,
  enabledDays: [...DEFAULT_FOLLOW_UP_CONFIG.enabledDays],
};

const WEEKDAYS: AutomationSchedule = {
  timeZone: "America/Argentina/Buenos_Aires",
  enabledDays: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "18:00",
};

const OWNER: HandoffRecipient = {
  userId: "owner-1",
  name: "Owner",
  email: "owner@example.test",
  role: "OWNER",
};

const ADMIN: HandoffRecipient = {
  userId: "admin-1",
  name: "Admin",
  email: "admin@example.test",
  role: "ADMIN",
};

const AGENT: HandoffRecipient = {
  userId: "agent-1",
  name: "Agent",
  email: "agent@example.test",
  role: "AGENT",
};

const VIEWER: HandoffRecipient = {
  userId: "viewer-1",
  name: "Viewer",
  email: "viewer@example.test",
  role: "VIEWER",
};

function eligibleSnapshot(
  overrides: Partial<FollowUpEligibilitySnapshot> = {}
): FollowUpEligibilitySnapshot {
  return {
    sameOrganization: true,
    sameConversation: true,
    eventTypeValid: true,
    eventExecutable: true,
    ruleEnabled: true,
    ruleValid: true,
    conversationOpen: true,
    humanTakeover: false,
    sourceValid: true,
    customerReplied: false,
    newerOutbound: false,
    maximumReached: false,
    channelAvailable: true,
    ...overrides,
  };
}

// ============================================================
// Reglas, permisos y mensajes configurables
// ============================================================

test("reglas: los valores predeterminados son válidos y seguros", () => {
  assert.equal(handoffRuleConfigSchema.safeParse(DEFAULT_HANDOFF_CONFIG).success, true);
  assert.equal(followUpRuleConfigSchema.safeParse(VALID_FOLLOW_UP_CONFIG).success, true);
  assert.equal(VALID_FOLLOW_UP_CONFIG.onlyOpenConversations, true);
  assert.equal(VALID_FOLLOW_UP_CONFIG.maxFollowUps, 1);
});

test("reglas: solo OWNER y ADMIN pueden gestionar; todos los roles pueden ver", () => {
  assert.equal(can("OWNER", AUTOMATION_RULE_PERMISSIONS.manage), true);
  assert.equal(can("ADMIN", AUTOMATION_RULE_PERMISSIONS.manage), true);
  assert.equal(can("AGENT", AUTOMATION_RULE_PERMISSIONS.manage), false);
  assert.equal(can("VIEWER", AUTOMATION_RULE_PERMISSIONS.manage), false);
  for (const role of ["OWNER", "ADMIN", "AGENT", "VIEWER"] as const) {
    assert.equal(can(role, AUTOMATION_RULE_PERMISSIONS.read), true);
  }
});

test("reglas: el navegador no puede inyectar organizationId ni campos secretos", () => {
  const followUp = automationRuleUpdateSchema.safeParse({
    type: "FOLLOW_UP",
    enabled: true,
    config: VALID_FOLLOW_UP_CONFIG,
    expectedVersion: 1,
    organizationId: "otra-organizacion",
  });
  const handoff = automationRuleUpdateSchema.safeParse({
    type: "HANDOFF_ALERT",
    enabled: true,
    config: { recipients: "BOTH", token: "no-admitido" },
    expectedVersion: null,
  });
  assert.equal(followUp.success, false);
  assert.equal(handoff.success, false);
});

test("reglas: exige una versión optimista válida o null al crear", () => {
  assert.equal(
    automationRuleUpdateSchema.safeParse({
      type: "HANDOFF_ALERT",
      enabled: false,
      config: DEFAULT_HANDOFF_CONFIG,
      expectedVersion: null,
    }).success,
    true
  );
  assert.equal(
    automationRuleUpdateSchema.safeParse({
      type: "FOLLOW_UP",
      enabled: true,
      config: VALID_FOLLOW_UP_CONFIG,
      expectedVersion: 2,
    }).success,
    true
  );
  for (const expectedVersion of [undefined, 0, 1.5, "1"]) {
    assert.equal(
      automationRuleUpdateSchema.safeParse({
        type: "HANDOFF_ALERT",
        enabled: false,
        config: DEFAULT_HANDOFF_CONFIG,
        expectedVersion,
      }).success,
      false
    );
  }
});

test("reglas: acepta únicamente destinatarios de handoff conocidos", () => {
  for (const recipients of ["ASSIGNED_AGENT", "OWNERS_ADMINS", "BOTH"]) {
    assert.equal(handoffRuleConfigSchema.safeParse({ recipients }).success, true);
  }
  assert.equal(
    handoffRuleConfigSchema.safeParse({ recipients: "ARBITRARY_EMAILS" }).success,
    false
  );
  assert.equal(
    handoffRuleConfigSchema.safeParse({ recipients: "BOTH", emails: ["x@test"] }).success,
    false
  );
});

test("reglas: restringe demora, máximo, horas, días y zona IANA", () => {
  const invalidConfigs = [
    { ...VALID_FOLLOW_UP_CONFIG, delayHours: 3 },
    { ...VALID_FOLLOW_UP_CONFIG, maxFollowUps: 0 },
    { ...VALID_FOLLOW_UP_CONFIG, maxFollowUps: 4 },
    { ...VALID_FOLLOW_UP_CONFIG, startTime: "24:00" },
    { ...VALID_FOLLOW_UP_CONFIG, endTime: VALID_FOLLOW_UP_CONFIG.startTime },
    { ...VALID_FOLLOW_UP_CONFIG, enabledDays: [] },
    { ...VALID_FOLLOW_UP_CONFIG, enabledDays: [1, 1] },
    { ...VALID_FOLLOW_UP_CONFIG, enabledDays: [0, 1] },
    { ...VALID_FOLLOW_UP_CONFIG, timeZone: "Mars/Olympus_Mons" },
    { ...VALID_FOLLOW_UP_CONFIG, onlyOpenConversations: false },
  ];
  for (const config of invalidConfigs) {
    assert.equal(followUpRuleConfigSchema.safeParse(config).success, false);
  }
});

test("reglas: rechaza placeholders arbitrarios, HTML y contenido ejecutable", () => {
  const invalidMessages = [
    "Hola {{phone}}, queremos retomar tu consulta pendiente.",
    "Hola {{ customerName }}, queremos retomar tu consulta.",
    "Hola {{customerName, queremos retomar tu consulta.",
    "<script>alert('x')</script> Mensaje suficientemente largo.",
    "javascript:alert('x') Mensaje suficientemente largo.",
    "Hola ${customerName}, este contenido no está permitido.",
  ];
  for (const message of invalidMessages) {
    assert.equal(
      followUpRuleConfigSchema.safeParse({
        ...VALID_FOLLOW_UP_CONFIG,
        message,
      }).success,
      false
    );
  }
});

test("reglas: permite solo los placeholders documentados, incluso repetidos", () => {
  const message =
    "Hola {{customerName}}. {{businessName}} sigue disponible para ayudarte, {{customerName}}.";
  assert.equal(
    followUpRuleConfigSchema.safeParse({
      ...VALID_FOLLOW_UP_CONFIG,
      message,
    }).success,
    true
  );
});

test("reglas: limita la longitud del mensaje configurable", () => {
  assert.equal(
    followUpRuleConfigSchema.safeParse({
      ...VALID_FOLLOW_UP_CONFIG,
      message: "Demasiado corto",
    }).success,
    false
  );
  assert.equal(
    followUpRuleConfigSchema.safeParse({
      ...VALID_FOLLOW_UP_CONFIG,
      message: "x".repeat(501),
    }).success,
    false
  );
});

test("reglas: parsea cada config según su tipo y rechaza configuraciones cruzadas", () => {
  assert.deepEqual(
    parseAutomationRuleConfig("HANDOFF_ALERT", DEFAULT_HANDOFF_CONFIG),
    DEFAULT_HANDOFF_CONFIG
  );
  assert.deepEqual(
    parseAutomationRuleConfig("FOLLOW_UP", VALID_FOLLOW_UP_CONFIG),
    VALID_FOLLOW_UP_CONFIG
  );
  assert.throws(() =>
    parseAutomationRuleConfig("HANDOFF_ALERT", VALID_FOLLOW_UP_CONFIG)
  );
  assert.throws(() =>
    parseAutomationRuleConfig("FOLLOW_UP", DEFAULT_HANDOFF_CONFIG)
  );
});

test("mensaje: renderiza valores permitidos y usa fallbacks seguros", () => {
  const template =
    "Hola {{customerName}}, el equipo de {{businessName}} sigue disponible para ayudarte.";
  assert.equal(
    renderFollowUpMessage(template, {
      customerName: "  Ana  ",
      businessName: "  Vantix  ",
    }),
    "Hola Ana, el equipo de Vantix sigue disponible para ayudarte."
  );
  assert.equal(
    renderFollowUpMessage(template, { customerName: " ", businessName: "" }),
    "Hola cliente, el equipo de nuestro equipo sigue disponible para ayudarte."
  );
});

test("webhooks: los contratos son estrictos y nunca aceptan contenido arbitrario", () => {
  const action = {
    eventId: "event-1",
    runId: "run-1",
    organizationId: "org-1",
    conversationId: "conversation-1",
    timestamp: 1_000_000,
  };
  assert.equal(n8nFollowUpActionSchema.safeParse(action).success, true);
  for (const injected of [
    { ...action, phone: "+5491112345678" },
    { ...action, message: "texto arbitrario" },
    { ...action, token: "no-admitido" },
  ]) {
    assert.equal(n8nFollowUpActionSchema.safeParse(injected).success, false);
  }
  assert.equal(
    n8nFollowUpActionSchema.safeParse({ ...action, runId: undefined }).success,
    false
  );

  const callback = {
    eventId: "event-1",
    runId: "run-1",
    organizationId: "org-1",
    timestamp: 1_000_000,
    status: "succeeded",
  };
  assert.equal(n8nCallbackSchema.safeParse(callback).success, true);
  assert.equal(
    n8nCallbackSchema.safeParse({ ...callback, stack: "detalle interno" }).success,
    false
  );
});

test("webhooks: el timestamp firmado debe coincidir exactamente con el header", () => {
  assert.equal(signedTimestampMatches(1_000_000, "1000000"), true);
  assert.equal(signedTimestampMatches(1_000_000, "1000001"), false);
  assert.equal(signedTimestampMatches(1_000_000, null), false);
});

test("webhooks: el lector acotado corta bodies declarados o transmitidos grandes", async () => {
  const declared = new Request("http://localhost/webhook", {
    method: "POST",
    headers: { "content-length": "4097" },
    body: "{}",
  });
  assert.deepEqual(await readLimitedRawBody(declared, 4096), {
    ok: false,
    reason: "too_large",
  });

  const streamed = new Request("http://localhost/webhook", {
    method: "POST",
    body: "x".repeat(17),
  });
  assert.deepEqual(await readLimitedRawBody(streamed, 16), {
    ok: false,
    reason: "too_large",
  });
});

test("API de automatizaciones: las respuestas privadas nunca se cachean", async () => {
  const response = automationJson({ ok: true });
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(await response.json(), { ok: true });
});

// ============================================================
// Horarios IANA, días y medianoche
// ============================================================

test("horarios: valida zonas IANA y rechaza nombres locales o inexistentes", () => {
  assert.equal(isValidIanaTimeZone("UTC"), true);
  assert.equal(isValidIanaTimeZone("America/Argentina/Buenos_Aires"), true);
  assert.equal(isValidIanaTimeZone("America/New_York"), true);
  assert.equal(isValidIanaTimeZone("GMT"), false);
  assert.equal(isValidIanaTimeZone("local"), false);
  assert.equal(isValidIanaTimeZone("Mars/Olympus_Mons"), false);
});

test("horarios: inicio inclusivo, fin exclusivo y día habilitado", () => {
  assert.equal(
    isAutomationTimeAllowed(new Date("2026-07-13T12:00:00.000Z"), WEEKDAYS),
    true
  );
  assert.equal(
    isAutomationTimeAllowed(new Date("2026-07-13T20:59:59.000Z"), WEEKDAYS),
    true
  );
  assert.equal(
    isAutomationTimeAllowed(new Date("2026-07-13T21:00:00.000Z"), WEEKDAYS),
    false
  );
  assert.equal(
    isAutomationTimeAllowed(new Date("2026-07-19T15:00:00.000Z"), WEEKDAYS),
    false
  );
});

test("horarios: usa la zona configurada y no la del servidor", () => {
  const newYork: AutomationSchedule = {
    timeZone: "America/New_York",
    enabledDays: [1],
    startTime: "09:00",
    endTime: "10:00",
  };
  const instant = new Date("2026-07-13T13:30:00.000Z");
  assert.equal(isAutomationTimeAllowed(instant, newYork), true);
  assert.equal(
    isAutomationTimeAllowed(instant, { ...WEEKDAYS, endTime: "10:00" }),
    false
  );
});

test("horarios: una ventana que cruza medianoche pertenece al día de inicio", () => {
  const overnight: AutomationSchedule = {
    timeZone: "America/Argentina/Buenos_Aires",
    enabledDays: [1],
    startTime: "22:00",
    endTime: "02:00",
  };
  // Lunes 22:30 y martes 01:30 locales pertenecen a la ventana del lunes.
  assert.equal(
    isAutomationTimeAllowed(new Date("2026-07-14T01:30:00.000Z"), overnight),
    true
  );
  assert.equal(
    isAutomationTimeAllowed(new Date("2026-07-14T04:30:00.000Z"), overnight),
    true
  );
  // Martes 02:00 es el fin exclusivo; martes 22:30 no está habilitado.
  assert.equal(
    isAutomationTimeAllowed(new Date("2026-07-14T05:00:00.000Z"), overnight),
    false
  );
  assert.equal(
    isAutomationTimeAllowed(new Date("2026-07-15T01:30:00.000Z"), overnight),
    false
  );
});

test("horarios: respeta el cambio DST provisto por IANA", () => {
  const dstSunday: AutomationSchedule = {
    timeZone: "America/New_York",
    enabledDays: [7],
    startTime: "01:00",
    endTime: "04:00",
  };
  // El 8/3/2026 salta de 01:59 EST a 03:00 EDT.
  assert.equal(
    isAutomationTimeAllowed(new Date("2026-03-08T06:30:00.000Z"), dstSunday),
    true
  );
  assert.equal(
    isAutomationTimeAllowed(new Date("2026-03-08T07:30:00.000Z"), dstSunday),
    true
  );
});

test("horarios: una configuración inválida falla cerrada", () => {
  assert.equal(
    isAutomationTimeAllowed(new Date(), { ...WEEKDAYS, timeZone: "Bad/Zone" }),
    false
  );
  assert.equal(
    isAutomationTimeAllowed(new Date(), { ...WEEKDAYS, enabledDays: [] }),
    false
  );
  assert.equal(
    isAutomationTimeAllowed(new Date(), {
      ...WEEKDAYS,
      startTime: "09:00",
      endTime: "09:00",
    }),
    false
  );
  assert.throws(() =>
    isAutomationTimeAllowed(new Date(), { ...WEEKDAYS, startTime: "25:00" })
  );
  assert.throws(() =>
    nextAutomationTimeAllowed(new Date(), { ...WEEKDAYS, timeZone: "Bad/Zone" })
  );
});

test("horarios: calcula el próximo minuto permitido sin perder UTC", () => {
  const next = nextAutomationTimeAllowed(
    new Date("2026-07-13T11:59:30.500Z"),
    WEEKDAYS
  );
  assert.equal(next.toISOString(), "2026-07-13T12:00:00.000Z");

  const alreadyAllowed = new Date("2026-07-13T12:30:15.250Z");
  const same = nextAutomationTimeAllowed(alreadyAllowed, WEEKDAYS);
  assert.equal(same.toISOString(), alreadyAllowed.toISOString());
  assert.notEqual(same, alreadyAllowed);
});

test("horarios: cambia de día y salta el fin de semana", () => {
  const next = nextAutomationTimeAllowed(
    new Date("2026-07-17T21:00:00.000Z"),
    WEEKDAYS
  );
  assert.equal(next.toISOString(), "2026-07-20T12:00:00.000Z");
});

test("horarios: aplica demora y reprograma al próximo horario comercial", () => {
  // Viernes 17:00 local + 2 horas cae fuera de horario: pasa al lunes 09:00.
  const due = scheduleAutomationAfterHours(
    new Date("2026-07-17T20:00:00.000Z"),
    2,
    WEEKDAYS
  );
  assert.equal(due.toISOString(), "2026-07-20T12:00:00.000Z");
});

test("horarios: encuentra el inicio de una ventana nocturna", () => {
  const overnight: AutomationSchedule = {
    timeZone: "America/Argentina/Buenos_Aires",
    enabledDays: [1],
    startTime: "22:00",
    endTime: "02:00",
  };
  const next = nextAutomationTimeAllowed(
    new Date("2026-07-14T00:00:00.000Z"),
    overnight
  );
  assert.equal(next.toISOString(), "2026-07-14T01:00:00.000Z");
});

// ============================================================
// Handoff: resolución, deduplicación y fallback
// ============================================================

test("handoff: selecciona únicamente al agente asignado cuando corresponde", () => {
  const result = resolveHandoffRecipients({
    strategy: "ASSIGNED_AGENT",
    assignedUserId: AGENT.userId,
    memberships: [OWNER, ADMIN, AGENT],
  });
  assert.equal(result.assignedAgent?.userId, AGENT.userId);
  assert.deepEqual(result.recipients.map((member) => member.userId), [AGENT.userId]);
});

test("handoff: selecciona propietarios y administradores", () => {
  const result = resolveHandoffRecipients({
    strategy: "OWNERS_ADMINS",
    assignedUserId: AGENT.userId,
    memberships: [OWNER, AGENT, ADMIN],
  });
  assert.deepEqual(
    result.recipients.map((member) => member.userId),
    [OWNER.userId, ADMIN.userId]
  );
});

test("handoff: BOTH combina agente y administradores sin duplicar", () => {
  const result = resolveHandoffRecipients({
    strategy: "BOTH",
    assignedUserId: OWNER.userId,
    memberships: [OWNER, ADMIN, OWNER],
  });
  assert.deepEqual(
    result.recipients.map((member) => member.userId),
    [OWNER.userId, ADMIN.userId]
  );
});

test("handoff: si el asignado ya no es miembro usa fallback OWNER/ADMIN", () => {
  const result = resolveHandoffRecipients({
    strategy: "ASSIGNED_AGENT",
    assignedUserId: "usuario-removido",
    memberships: [OWNER, ADMIN, AGENT],
  });
  assert.equal(result.assignedAgent, null);
  assert.deepEqual(
    result.recipients.map((member) => member.userId),
    [OWNER.userId, ADMIN.userId]
  );
});

test("handoff: un VIEWER asignado no recibe avisos y usa fallback operativo", () => {
  const result = resolveHandoffRecipients({
    strategy: "ASSIGNED_AGENT",
    assignedUserId: VIEWER.userId,
    memberships: [VIEWER, OWNER, ADMIN],
  });
  assert.equal(result.assignedAgent, null);
  assert.deepEqual(
    result.recipients.map((recipient) => recipient.userId),
    [OWNER.userId, ADMIN.userId]
  );
});

test("handoff: sin asignado ni administradores produce lista segura vacía", () => {
  const result = resolveHandoffRecipients({
    strategy: "BOTH",
    assignedUserId: null,
    memberships: [AGENT],
  });
  assert.equal(result.assignedAgent, null);
  assert.deepEqual(result.recipients, []);
});

test("handoff: siempre deja historial y solo despacha con regla activa válida", () => {
  assert.deepEqual(
    resolveHandoffEventDispatchState({ enabled: false, configValid: false }),
    { status: "CANCELLED", cancellationReason: "rule_disabled" }
  );
  assert.deepEqual(
    resolveHandoffEventDispatchState({ enabled: true, configValid: false }),
    { status: "CANCELLED", cancellationReason: "rule_invalid" }
  );
  assert.deepEqual(
    resolveHandoffEventDispatchState({ enabled: true, configValid: true }),
    { status: "PENDING", cancellationReason: null }
  );
});

test("handoff: clave idempotente es estable por conversación y mensaje origen", () => {
  const key = handoffIdempotencyKey("conversation-1", "message-1");
  assert.equal(key, handoffIdempotencyKey("conversation-1", "message-1"));
  assert.notEqual(key, handoffIdempotencyKey("conversation-1", "message-2"));
  assert.notEqual(key, handoffIdempotencyKey("conversation-2", "message-1"));
  assert.match(key, /^conversation\.handoff_requested:/);
  assert.ok(handoffIdempotencyKey("c".repeat(300), "m".repeat(300)).length <= 200);
});

test("handoff: distingue explícitamente la ausencia de mensaje origen", () => {
  assert.equal(
    handoffIdempotencyKey("conversation-1", null),
    "conversation.handoff_requested:conversation-1:no-source"
  );
});

test("handoff: si el outbox falla ejecuta el fallback y conserva la derivación", async () => {
  const seenErrors: string[] = [];
  let fallbackCalls = 0;
  const result = await runHandoffWithFallback(
    async () => {
      throw new Error("outbox_unavailable");
    },
    async () => {
      fallbackCalls += 1;
      return { changed: true, eventId: null };
    },
    (error) => seenErrors.push(error instanceof Error ? error.message : "unknown")
  );
  assert.deepEqual(result, { changed: true, eventId: null });
  assert.equal(fallbackCalls, 1);
  assert.deepEqual(seenErrors, ["outbox_unavailable"]);
});

test("handoff: un outbox exitoso no ejecuta el fallback", async () => {
  let fallbackCalls = 0;
  const result = await runHandoffWithFallback<{
    changed: boolean;
    eventId: string | null;
  }>(
    async () => ({ changed: true, eventId: "event-1" }),
    async () => {
      fallbackCalls += 1;
      return { changed: true, eventId: null };
    }
  );
  assert.deepEqual(result, { changed: true, eventId: "event-1" });
  assert.equal(fallbackCalls, 0);
});

// ============================================================
// Seguimientos: elegibilidad e idempotencia
// ============================================================

test("follow-up: permite únicamente un snapshot completamente elegible", () => {
  assert.deepEqual(decideFollowUpEligibility(eligibleSnapshot()), { allowed: true });
});

test("follow-up: rechaza organización, conversación, tipo o estado incorrectos", () => {
  for (const overrides of [
    { sameOrganization: false },
    { sameConversation: false },
    { eventTypeValid: false },
    { eventExecutable: false },
  ]) {
    assert.deepEqual(decideFollowUpEligibility(eligibleSnapshot(overrides)), {
      allowed: false,
      reason: "not_executable",
    });
  }
});

test("follow-up: un evento cancelado o no ejecutable nunca puede enviar", () => {
  assert.deepEqual(
    decideFollowUpEligibility(eligibleSnapshot({ eventExecutable: false })),
    { allowed: false, reason: "not_executable" }
  );
});

test("follow-up: rechaza regla pausada o inválida", () => {
  assert.deepEqual(
    decideFollowUpEligibility(eligibleSnapshot({ ruleEnabled: false })),
    { allowed: false, reason: "rule_disabled" }
  );
  assert.deepEqual(
    decideFollowUpEligibility(eligibleSnapshot({ ruleValid: false })),
    { allowed: false, reason: "rule_invalid" }
  );
});

test("follow-up: rechaza conversación cerrada, origen inválido y canal caído", () => {
  assert.deepEqual(
    decideFollowUpEligibility(eligibleSnapshot({ conversationOpen: false })),
    { allowed: false, reason: "conversation_closed" }
  );
  assert.deepEqual(
    decideFollowUpEligibility(eligibleSnapshot({ sourceValid: false })),
    { allowed: false, reason: "source_invalid" }
  );
  assert.deepEqual(
    decideFollowUpEligibility(eligibleSnapshot({ humanTakeover: true })),
    { allowed: false, reason: "human_takeover" }
  );
  assert.deepEqual(
    decideFollowUpEligibility(eligibleSnapshot({ channelAvailable: false })),
    { allowed: false, reason: "channel_unavailable" }
  );
});

test("follow-up: cancela ante respuesta, saliente posterior o máximo alcanzado", () => {
  assert.deepEqual(
    decideFollowUpEligibility(eligibleSnapshot({ customerReplied: true })),
    { allowed: false, reason: "customer_replied" }
  );
  assert.deepEqual(
    decideFollowUpEligibility(eligibleSnapshot({ newerOutbound: true })),
    { allowed: false, reason: "outbound_replaced" }
  );
  assert.deepEqual(
    decideFollowUpEligibility(eligibleSnapshot({ maximumReached: true })),
    { allowed: false, reason: "maximum_reached" }
  );
});

test("follow-up: prioriza fallar cerrado ante múltiples condiciones inválidas", () => {
  assert.deepEqual(
    decideFollowUpEligibility(
      eligibleSnapshot({
        sameOrganization: false,
        ruleEnabled: false,
        customerReplied: true,
        channelAvailable: false,
      })
    ),
    { allowed: false, reason: "not_executable" }
  );
});

test("follow-up: clave idempotente es estable y distinta por mensaje origen", () => {
  const input = {
    organizationId: "org-1",
    conversationId: "conversation-1",
    sourceMessageId: "message-1",
  };
  const first = followUpIdempotencyKey(input);
  assert.equal(first, followUpIdempotencyKey(input));
  assert.notEqual(
    first,
    followUpIdempotencyKey({ ...input, sourceMessageId: "message-2" })
  );
  assert.notEqual(
    first,
    followUpIdempotencyKey({ ...input, organizationId: "org-2" })
  );
  assert.notEqual(
    first,
    followUpIdempotencyKey({ ...input, conversationId: "conversation-2" })
  );
  assert.match(first, /^conversation\.followup_due:/);
  assert.ok(
    followUpIdempotencyKey({
      organizationId: "o".repeat(200),
      conversationId: "c".repeat(200),
      sourceMessageId: "m".repeat(500),
    }).length <= 200
  );
});

test("follow-up: toda cancelación construye un scope explícito de organización", () => {
  assert.deepEqual(
    buildFollowUpCancellationScope({
      organizationId: "org-a",
      conversationId: "conversation-a",
    }),
    {
      organizationId: "org-a",
      type: "conversation.followup_due",
      conversationId: "conversation-a",
    }
  );
  assert.deepEqual(
    buildFollowUpCancellationScope({
      organizationId: "org-b",
      integrationId: "integration-b",
    }),
    {
      organizationId: "org-b",
      type: "conversation.followup_due",
      conversation: { whatsappIntegrationId: "integration-b" },
    }
  );
});

test("follow-up: retries de acción no vuelven a enviar ni reportan éxito falso", () => {
  assert.equal(
    resolveExistingFollowUpAction({
      deliveryStatus: "SENT",
      actionClaimedAt: new Date(),
    }),
    "already_sent"
  );
  assert.equal(
    resolveExistingFollowUpAction({
      deliveryStatus: "PENDING",
      actionClaimedAt: null,
    }),
    "resume"
  );
  assert.equal(
    resolveExistingFollowUpAction({
      deliveryStatus: "PENDING",
      actionClaimedAt: new Date(),
    }),
    "in_progress"
  );
  assert.equal(
    resolveExistingFollowUpAction({
      deliveryStatus: "FAILED",
      actionClaimedAt: null,
    }),
    "failed"
  );
});

test("follow-up: un claim stale se reconcilia sin volver a enviar", () => {
  const base = {
    eventType: "conversation.followup_due",
    actionClaimedAt: new Date(),
  };
  assert.equal(
    resolveStaleFollowUpAction({ ...base, deliveryStatus: "SENT" }),
    "sent"
  );
  assert.equal(
    resolveStaleFollowUpAction({ ...base, deliveryStatus: "FAILED" }),
    "failed"
  );
  assert.equal(
    resolveStaleFollowUpAction({ ...base, deliveryStatus: "PENDING" }),
    "ambiguous"
  );
  assert.equal(
    resolveStaleFollowUpAction({
      eventType: "conversation.followup_due",
      actionClaimedAt: null,
      deliveryStatus: "PENDING",
    }),
    null
  );
  assert.equal(
    resolveStaleFollowUpAction({
      eventType: "conversation.handoff_requested",
      actionClaimedAt: new Date(),
      deliveryStatus: "SENT",
    }),
    null
  );
});

test("callback: correlaciona el run exacto y rechaza intentos tardíos", () => {
  assert.equal(
    isCurrentAutomationCallback({
      runStatus: "STARTED",
      eventStatus: "PROCESSING",
      runAttempt: 2,
      eventAttempts: 2,
    }),
    true
  );
  for (const value of [
    {
      runStatus: "FAILED" as const,
      eventStatus: "PROCESSING" as const,
      runAttempt: 2,
      eventAttempts: 2,
    },
    {
      runStatus: "STARTED" as const,
      eventStatus: "PROCESSING" as const,
      runAttempt: 1,
      eventAttempts: 2,
    },
    {
      runStatus: "STARTED" as const,
      eventStatus: "SUCCEEDED" as const,
      runAttempt: 2,
      eventAttempts: 2,
    },
  ]) {
    assert.equal(isCurrentAutomationCallback(value), false);
  }
});

test("callback: las acciones deben completarse antes de aceptar éxito", () => {
  for (const status of ["SENT", "DELIVERED", "READ"]) {
    assert.equal(
      canAcceptSuccessfulAutomationCallback({
        eventType: "conversation.followup_due",
        actionDeliveryStatus: status,
      }),
      true
    );
  }
  for (const status of [null, "PENDING", "FAILED"]) {
    assert.equal(
      canAcceptSuccessfulAutomationCallback({
        eventType: "conversation.followup_due",
        actionDeliveryStatus: status,
      }),
      false
    );
  }
  assert.equal(
    canAcceptSuccessfulAutomationCallback({
      eventType: "conversation.handoff_requested",
      actionDeliveryStatus: null,
    }),
    false
  );
  assert.equal(
    canAcceptSuccessfulAutomationCallback({
      eventType: "conversation.handoff_requested",
      actionDeliveryStatus: null,
      actionCompletedAt: new Date(),
      handoffDeliveryStatuses: [],
    }),
    false
  );
  assert.equal(
    canAcceptSuccessfulAutomationCallback({
      eventType: "conversation.handoff_requested",
      actionDeliveryStatus: null,
      actionCompletedAt: new Date(),
      handoffDeliveryStatuses: ["SENT", "SENT"],
    }),
    true
  );
  for (const statuses of [
    ["PROCESSING"],
    ["SENT", "PROCESSING"],
    ["SENT", "FAILED"],
  ]) {
    assert.equal(
      canAcceptSuccessfulAutomationCallback({
        eventType: "conversation.handoff_requested",
        actionDeliveryStatus: null,
        actionCompletedAt: new Date(),
        handoffDeliveryStatuses: statuses,
      }),
      false
    );
  }
  assert.equal(
    canAcceptSuccessfulAutomationCallback({
      eventType: "automation.connection_test",
      actionDeliveryStatus: null,
    }),
    true
  );
});

test("handoff: reconciliación stale nunca vuelve a enviar una acción reclamada", () => {
  const claimed = {
    eventType: "conversation.handoff_requested",
    actionClaimedAt: new Date(),
  };
  assert.equal(
    resolveStaleHandoffAction({ ...claimed, deliveryStatuses: ["SENT"] }),
    "sent"
  );
  assert.equal(
    resolveStaleHandoffAction({
      ...claimed,
      deliveryStatuses: ["SENT", "SENT"],
    }),
    "sent"
  );
  assert.equal(
    resolveStaleHandoffAction({
      ...claimed,
      deliveryStatuses: ["SENT", "FAILED"],
    }),
    "failed"
  );
  assert.equal(
    resolveStaleHandoffAction({
      ...claimed,
      deliveryStatuses: ["PROCESSING"],
    }),
    "ambiguous"
  );
  assert.equal(
    resolveStaleHandoffAction({ ...claimed, deliveryStatuses: [] }),
    "ambiguous"
  );
  assert.equal(
    resolveStaleHandoffAction({
      ...claimed,
      actionClaimedAt: null,
      deliveryStatuses: ["SENT"],
    }),
    null
  );
  assert.equal(
    resolveStaleHandoffAction({
      ...claimed,
      eventType: "conversation.followup_due",
      deliveryStatuses: ["SENT"],
    }),
    null
  );
});

test("follow-up: decisiones puras son deterministas bajo evaluación concurrente", async () => {
  const snapshots = Array.from({ length: 64 }, (_, index) =>
    eligibleSnapshot({ customerReplied: index % 2 === 1 })
  );
  const results = await Promise.all(
    snapshots.map((snapshot) =>
      Promise.resolve().then(() => decideFollowUpEligibility(snapshot))
    )
  );
  for (const [index, result] of results.entries()) {
    assert.deepEqual(
      result,
      index % 2 === 1
        ? { allowed: false, reason: "customer_replied" }
        : { allowed: true }
    );
  }
});

// ============================================================
// Acción firmada: HMAC, timestamp y payload alterado
// ============================================================

test("follow-up firmado: exige modo n8n y un run del proveedor n8n", () => {
  assert.equal(
    canExecuteN8nFollowUpAction({
      providerMode: "n8n",
      runProvider: "n8n",
    }),
    true
  );
  assert.equal(
    canExecuteN8nFollowUpAction({
      providerMode: "mock",
      runProvider: "n8n",
    }),
    false
  );
  assert.equal(
    canExecuteN8nFollowUpAction({
      providerMode: "n8n",
      runProvider: "mock",
    }),
    false
  );
});

test("acción n8n: firma los bytes exactos del payload con timestamp incluido", () => {
  const body = JSON.stringify({
    eventId: "event-1",
    runId: "run-1",
    organizationId: "org-1",
    conversationId: "conversation-1",
    timestamp: 1_000_000,
  });
  const signature = signAutomationBody(body, "secret-for-tests");
  assert.match(signature, /^sha256=[a-f0-9]{64}$/);
  assert.equal(
    verifyAutomationSignature(body, signature, "secret-for-tests"),
    true
  );
});

test("acción n8n: rechaza alteraciones de evento, run, organización, conversación o timestamp", () => {
  const payload = {
    eventId: "event-1",
    runId: "run-1",
    organizationId: "org-1",
    conversationId: "conversation-1",
    timestamp: 1_000_000,
  };
  const body = JSON.stringify(payload);
  const signature = signAutomationBody(body, "secret-for-tests");
  const altered = [
    { ...payload, eventId: "event-2" },
    { ...payload, runId: "run-2" },
    { ...payload, organizationId: "org-2" },
    { ...payload, conversationId: "conversation-2" },
    { ...payload, timestamp: payload.timestamp + 1 },
  ];
  for (const value of altered) {
    assert.equal(
      verifyAutomationSignature(
        JSON.stringify(value),
        signature,
        "secret-for-tests"
      ),
      false
    );
  }
});

test("acción n8n: reserializar o cambiar whitespace invalida la firma", () => {
  const compact = JSON.stringify({ eventId: "e", organizationId: "o", timestamp: 1 });
  const pretty = JSON.stringify(
    { eventId: "e", organizationId: "o", timestamp: 1 },
    null,
    2
  );
  const signature = signAutomationBody(compact, "secret-for-tests");
  assert.equal(
    verifyAutomationSignature(pretty, signature, "secret-for-tests"),
    false
  );
  assert.equal(
    verifyAutomationSignature(`${compact}\n`, signature, "secret-for-tests"),
    false
  );
});

test("acción n8n: rechaza secreto y formatos de firma incorrectos", () => {
  const body = "{}";
  const signature = signAutomationBody(body, "secret-for-tests");
  assert.equal(verifyAutomationSignature(body, signature, "other-secret"), false);
  assert.equal(verifyAutomationSignature(body, null, "secret-for-tests"), false);
  assert.equal(verifyAutomationSignature(body, "", "secret-for-tests"), false);
  assert.equal(
    verifyAutomationSignature(body, `sha1=${"a".repeat(64)}`, "secret-for-tests"),
    false
  );
  assert.equal(
    verifyAutomationSignature(body, `sha256=${"z".repeat(64)}`, "secret-for-tests"),
    false
  );
  assert.equal(
    verifyAutomationSignature(body, `sha256=${"a".repeat(63)}`, "secret-for-tests"),
    false
  );
});

test("acción n8n: timestamp acepta límites y rechaza viejo, futuro o inválido", () => {
  const now = 2_000_000_000_000;
  const tolerance = 5 * 60 * 1000;
  assert.equal(isTimestampFresh(String(now), tolerance, now), true);
  assert.equal(isTimestampFresh(String(now - tolerance), tolerance, now), true);
  assert.equal(isTimestampFresh(String(now + tolerance), tolerance, now), true);
  assert.equal(isTimestampFresh(String(now - tolerance - 1), tolerance, now), false);
  assert.equal(isTimestampFresh(String(now + tolerance + 1), tolerance, now), false);
  assert.equal(isTimestampFresh("0", tolerance, now), false);
  assert.equal(isTimestampFresh("NaN", tolerance, now), false);
  assert.equal(isTimestampFresh(null, tolerance, now), false);
});

test("acción n8n: firmas concurrentes no se mezclan entre payloads", async () => {
  const secret = "secret-for-tests";
  const bodies = Array.from({ length: 64 }, (_, index) =>
    JSON.stringify({
      eventId: `event-${index}`,
      runId: `run-${index}`,
      organizationId: `org-${index % 4}`,
      conversationId: `conversation-${index}`,
      timestamp: 2_000_000_000_000 + index,
    })
  );
  const signatures = await Promise.all(
    bodies.map((body) => Promise.resolve().then(() => signAutomationBody(body, secret)))
  );
  for (let index = 0; index < bodies.length; index += 1) {
    assert.equal(
      verifyAutomationSignature(bodies[index]!, signatures[index]!, secret),
      true
    );
    assert.equal(
      verifyAutomationSignature(
        bodies[index]!,
        signatures[(index + 1) % signatures.length]!,
        secret
      ),
      false
    );
  }
});
