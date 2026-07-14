import assert from "node:assert/strict";
import { test } from "node:test";
import { can } from "@/lib/permissions";
import {
  automationEventQuerySchema,
  automationRunQuerySchema,
  automationTestBodySchema,
} from "@/lib/validations/automation";
import {
  buildAutomationEventWhere,
  calculateAutomationOverview,
  resolveAutomationPagination,
  resolveAutomationRange,
} from "@/server/automation/dashboard";
import {
  buildCancelTransitionWhere,
  buildRetryTransitionWhere,
  canCancelAutomationStatus,
  canRetryAutomationStatus,
  performAutomationOperation,
} from "@/server/automation/operations";
import {
  isSensitiveAutomationKey,
  maskIdempotencyKey,
  sanitizeAutomationMessage,
  sanitizeAutomationValue,
} from "@/server/automation/sanitization";

test("automation.view permite todos los roles y manage queda limitado", () => {
  for (const role of ["OWNER", "ADMIN", "AGENT", "VIEWER"] as const) {
    assert.equal(can(role, "automation.view"), true);
  }
  assert.equal(can("OWNER", "automation.manage"), true);
  assert.equal(can("ADMIN", "automation.manage"), true);
  assert.equal(can("AGENT", "automation.manage"), false);
  assert.equal(can("VIEWER", "automation.manage"), false);
});

test("las consultas validan paginación, estados, orden y longitudes", () => {
  const valid = automationEventQuerySchema.parse({
    page: "2",
    pageSize: "20",
    period: "24h",
    status: "FAILED",
    q: "evt-123",
    order: "asc",
  });
  assert.deepEqual(valid, {
    page: 2,
    pageSize: 20,
    period: "24h",
    status: "FAILED",
    q: "evt-123",
    order: "asc",
  });
  assert.equal(automationEventQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(automationEventQuerySchema.safeParse({ pageSize: 500 }).success, false);
  assert.equal(automationEventQuerySchema.safeParse({ status: "UNKNOWN" }).success, false);
  assert.equal(automationRunQuerySchema.safeParse({ status: "PENDING" }).success, false);
  assert.equal(automationRunQuerySchema.safeParse({ provider: "x".repeat(121) }).success, false);
  assert.deepEqual(resolveAutomationPagination(2, 20), { skip: 20, take: 20 });
});

test("el endpoint de prueba acepta solo modos controlados y rechaza campos extra", () => {
  for (const mock of ["success", "temporary_error", "permanent_error", "callback"]) {
    assert.equal(automationTestBodySchema.safeParse({ mock }).success, true);
  }
  assert.equal(automationTestBodySchema.safeParse({ mock: "custom" }).success, false);
  assert.equal(
    automationTestBodySchema.safeParse({ mock: "success", organizationId: "otra-org" }).success,
    false
  );
});

test("cada filtro de eventos incluye obligatoriamente la organización de sesión", () => {
  const query = automationEventQuerySchema.parse({
    period: "7d",
    status: "FAILED",
    type: "automation.test",
    q: "evt",
  });
  const now = new Date("2026-07-14T15:00:00.000Z");
  const where = buildAutomationEventWhere("org-segura", query, now);
  assert.equal(where.organizationId, "org-segura");
  assert.equal(where.status, "FAILED");
  assert.equal(where.type, "automation.test");
  assert.deepEqual(where.id, { contains: "evt", mode: "insensitive" });
  assert.deepEqual(where.createdAt, {
    gte: new Date("2026-07-07T15:00:00.000Z"),
    lte: now,
  });
});

test("los rangos son móviles y exactos para 24h, 7d y 30d", () => {
  const now = new Date("2026-07-14T15:00:00.000Z");
  assert.equal(resolveAutomationRange("24h", now).from.toISOString(), "2026-07-13T15:00:00.000Z");
  assert.equal(resolveAutomationRange("7d", now).from.toISOString(), "2026-07-07T15:00:00.000Z");
  assert.equal(resolveAutomationRange("30d", now).from.toISOString(), "2026-06-14T15:00:00.000Z");
});

test("el resumen calcula totales, terminales y tasa de éxito", () => {
  const overview = calculateAutomationOverview(
    {
      PENDING: 2,
      PROCESSING: 1,
      SUCCEEDED: 8,
      FAILED: 1,
      DEAD_LETTER: 1,
      CANCELLED: 2,
    },
    1234.7
  );
  assert.equal(overview.total, 15);
  assert.equal(overview.successRate, 80);
  assert.equal(overview.averageDurationMs, 1235);
  assert.equal(calculateAutomationOverview({}, null).successRate, 0);
});

test("las transiciones administrativas aceptan únicamente estados seguros", () => {
  assert.equal(canRetryAutomationStatus("FAILED"), true);
  assert.equal(canRetryAutomationStatus("DEAD_LETTER"), true);
  assert.equal(canRetryAutomationStatus("SUCCEEDED"), false);
  assert.equal(canCancelAutomationStatus("PENDING"), true);
  assert.equal(canCancelAutomationStatus("PROCESSING"), false);
});

test("las condiciones atómicas de retry/cancel siempre incluyen organización y estado", () => {
  assert.deepEqual(buildRetryTransitionWhere("evt-1", "org-a"), {
    id: "evt-1",
    organizationId: "org-a",
    status: { in: ["FAILED", "DEAD_LETTER"] },
  });
  assert.deepEqual(buildCancelTransitionWhere("evt-2", "org-b"), {
    id: "evt-2",
    organizationId: "org-b",
    status: "PENDING",
  });
});

test("una carrera de estado rechaza la transición sin confirmar éxito", async () => {
  let auditedTransition = 0;
  const result = await performAutomationOperation(
    "retry",
    { id: "evt-1", organizationId: "org-a", userId: "user-a" },
    {
      findStatus: async () => "FAILED",
      transitionAndAudit: async () => {
        auditedTransition += 1;
        return false;
      },
    }
  );
  assert.deepEqual(result, {
    ok: false,
    code: "conflict",
    message: "El evento cambió de estado.",
  });
  assert.equal(auditedTransition, 1);
});

test("un evento de otra organización se trata como inexistente y no transiciona", async () => {
  let transitionCalled = false;
  const result = await performAutomationOperation(
    "cancel",
    { id: "evt-otra-org", organizationId: "org-sesion", userId: "user-a" },
    {
      findStatus: async (input) => {
        assert.equal(input.organizationId, "org-sesion");
        return null;
      },
      transitionAndAudit: async () => {
        transitionCalled = true;
        return true;
      },
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "not_found");
  assert.equal(transitionCalled, false);
});

test("el sanitizador recursivo oculta todas las familias de claves sensibles", () => {
  const input = {
    password: "uno",
    nested: {
      webhookSecret: "dos",
      api_key: "tres",
      child: [{ accessToken: "cuatro" }, { refresh_token: "cinco" }],
    },
    AuthorizationHeader: "seis",
    cookies: "siete",
    credentials: { user: "ocho" },
    safe: "visible",
  };
  const sanitized = sanitizeAutomationValue(input) as Record<string, unknown>;
  const serialized = JSON.stringify(sanitized);
  for (const secret of ["uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho"]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(serialized.includes("visible"), true);
  for (const key of ["password", "secretToken", "authorization", "cookie", "apiKey", "access_token", "refreshToken", "webhook-secret", "credentialId"]) {
    assert.equal(isSensitiveAutomationKey(key), true);
  }
});

test("errores e idempotencia se entregan sanitizados o enmascarados", () => {
  const message = sanitizeAutomationMessage(
    "token=valor-super-secreto postgresql://user:clave@db.example/app\nstack"
  );
  assert.equal(message?.includes("valor-super-secreto"), false);
  assert.equal(message?.includes("clave"), false);
  assert.equal(message?.includes("stack"), false);
  const masked = maskIdempotencyKey("automation.test:organizacion:identificador-largo");
  assert.equal(masked.length < "automation.test:organizacion:identificador-largo".length, true);
});
