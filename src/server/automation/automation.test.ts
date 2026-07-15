import assert from "node:assert/strict";
import { test } from "node:test";
import { can } from "@/lib/permissions";
import { backoffDelayMs } from "@/server/automation/backoff";
import { resolveCallbackTransition } from "@/server/automation/callback";
import {
  decideAfterDispatch,
  decideStaleProcessing,
} from "@/server/automation/decide";
import {
  emitAutomationEvent,
  validateEmitInput,
  type EmitDeps,
} from "@/server/automation/events";
import { MockProvider } from "@/server/automation/providers/mock";
import {
  canDispatchN8nEvent,
  isN8nConnectionProbeEvent,
} from "@/server/automation/providers/n8n";
import {
  getCronSecret,
  isDispatcherEnabledSignal,
  isN8nWorkflowsPublishedSignal,
} from "@/server/automation/config";
import {
  isTimestampFresh,
  signAutomationBody,
  verifyAutomationSignature,
} from "@/server/automation/signature";
import type { AutomationWebhookPayload } from "@/server/automation/types";
import {
  n8nProbeIdempotencyKey,
  shouldReuseN8nProbe,
} from "@/app/api/automation/test-connection/route";

const SECRET = "clave-secreta-de-prueba";

function webhook(
  overrides: Partial<AutomationWebhookPayload> = {}
): AutomationWebhookPayload {
  return {
    eventId: "evt-1",
    runId: "run-1",
    organizationId: "org-a",
    type: "automation.test",
    timestamp: Date.now(),
    schemaVersion: 1,
    idempotencyKey: "key-1",
    payload: {},
    ...overrides,
  };
}

// ============================================================
// Firma HMAC
// ============================================================

test("firma HMAC: roundtrip válido", () => {
  const body = JSON.stringify(webhook());
  const signature = signAutomationBody(body, SECRET);
  assert.match(signature, /^sha256=[a-f0-9]{64}$/);
  assert.equal(verifyAutomationSignature(body, signature, SECRET), true);
});

test("firma HMAC: rechaza firma inválida, body alterado y secreto incorrecto", () => {
  const body = JSON.stringify(webhook());
  const signature = signAutomationBody(body, SECRET);
  assert.equal(verifyAutomationSignature(body, "sha256=" + "0".repeat(64), SECRET), false);
  assert.equal(verifyAutomationSignature(body + " ", signature, SECRET), false);
  assert.equal(verifyAutomationSignature(body, signature, "otro-secreto"), false);
  assert.equal(verifyAutomationSignature(body, null, SECRET), false);
  assert.equal(verifyAutomationSignature(body, "no-es-una-firma", SECRET), false);
});

test("timestamp: acepta reciente y rechaza viejo/futuro/ausente (anti-replay)", () => {
  const now = 1_000_000_000_000;
  assert.equal(isTimestampFresh(String(now), 5 * 60 * 1000, now), true);
  assert.equal(isTimestampFresh(String(now - 10 * 60 * 1000), 5 * 60 * 1000, now), false);
  assert.equal(isTimestampFresh(String(now + 10 * 60 * 1000), 5 * 60 * 1000, now), false);
  assert.equal(isTimestampFresh(null, 5 * 60 * 1000, now), false);
  assert.equal(isTimestampFresh("no-numero", 5 * 60 * 1000, now), false);
});

// ============================================================
// Backoff y decisiones de la cola
// ============================================================

test("backoff crece exponencialmente y tiene tope", () => {
  const d1 = backoffDelayMs(1, 1000, 60_000);
  const d2 = backoffDelayMs(2, 1000, 60_000);
  const d3 = backoffDelayMs(3, 1000, 60_000);
  assert.ok(d2 > d1 && d3 > d2);
  assert.equal(backoffDelayMs(100, 1000, 60_000), 60_000);
});

test("decideAfterDispatch: éxito sincrónico -> SUCCEEDED", () => {
  const d = decideAfterDispatch({
    attempts: 1,
    maxAttempts: 5,
    result: { ok: true, awaitingCallback: false },
  });
  assert.equal(d.status, "SUCCEEDED");
  assert.ok(d.processedAt);
  assert.equal(d.clearLock, true);
});

test("decideAfterDispatch: enviado esperando callback -> PROCESSING sin liberar lock", () => {
  const d = decideAfterDispatch({
    attempts: 1,
    maxAttempts: 5,
    result: { ok: true, awaitingCallback: true },
  });
  assert.equal(d.status, "PROCESSING");
  assert.equal(d.clearLock, false);
  assert.equal(d.processedAt, null);
});

test("decideAfterDispatch: error no reintentable -> FAILED", () => {
  const d = decideAfterDispatch({
    attempts: 1,
    maxAttempts: 5,
    result: { ok: false, retryable: false, errorCode: "mock_permanent", errorMessage: "x" },
  });
  assert.equal(d.status, "FAILED");
});

test("decideAfterDispatch: error reintentable con intentos disponibles -> PENDING con backoff", () => {
  const d = decideAfterDispatch({
    attempts: 2,
    maxAttempts: 5,
    result: { ok: false, retryable: true, errorCode: "mock_temporary", errorMessage: "x" },
    now: new Date(0),
  });
  assert.equal(d.status, "PENDING");
  assert.ok(d.nextAttemptAt && d.nextAttemptAt.getTime() > 0);
});

test("decideAfterDispatch: error reintentable agotado -> DEAD_LETTER", () => {
  const d = decideAfterDispatch({
    attempts: 5,
    maxAttempts: 5,
    result: { ok: false, retryable: true, errorCode: "mock_temporary", errorMessage: "x" },
  });
  assert.equal(d.status, "DEAD_LETTER");
});

test("decideStaleProcessing: recupera a PENDING o pasa a DEAD_LETTER si se agotó", () => {
  assert.equal(decideStaleProcessing({ attempts: 1, maxAttempts: 5 }).status, "PENDING");
  assert.equal(decideStaleProcessing({ attempts: 5, maxAttempts: 5 }).status, "DEAD_LETTER");
});

// ============================================================
// Validación y emisión de eventos
// ============================================================

test("validateEmitInput: rechaza tipo, payload no-objeto y payload gigante", () => {
  assert.equal(validateEmitInput({ organizationId: "o", type: "tipo.invalido" }).ok, false);
  assert.equal(
    validateEmitInput({
      organizationId: "o",
      type: "automation.test",
      payload: ["no-objeto"] as unknown as Record<string, unknown>,
    }).ok,
    false
  );
  const big = { data: "x".repeat(40 * 1024) };
  assert.equal(
    validateEmitInput({ organizationId: "o", type: "automation.test", payload: big }).ok,
    false
  );
});

test("validateEmitInput: genera idempotencyKey y conserva la provista", () => {
  const generated = validateEmitInput({ organizationId: "o", type: "automation.test" });
  assert.ok(generated.ok && generated.idempotencyKey.startsWith("automation.test:"));
  const provided = validateEmitInput({
    organizationId: "o",
    type: "automation.test",
    idempotencyKey: "mi-clave",
  });
  assert.ok(provided.ok && provided.idempotencyKey === "mi-clave");
});

test("emitAutomationEvent: falla si la organización no existe (no crea)", async () => {
  let created = 0;
  const result = await emitAutomationEvent(
    { organizationId: "org-x", type: "automation.test", payload: {} },
    {
      organizationExists: async () => false,
      findByIdempotencyKey: async () => null,
      createEvent: async () => {
        created += 1;
        return { id: "no" };
      },
      maxAttempts: 5,
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "organization_not_found");
  assert.equal(created, 0);
});

test("emitAutomationEvent: es idempotente y aísla por organización", async () => {
  const seenOrgs: string[] = [];
  const deps: Partial<EmitDeps> = {
    organizationExists: async () => true,
    findByIdempotencyKey: async (orgId) => {
      seenOrgs.push(orgId);
      return { id: "existente" };
    },
    createEvent: async () => {
      throw new Error("no debería crear un duplicado");
    },
    maxAttempts: 5,
  };
  const result = await emitAutomationEvent(
    { organizationId: "org-a", type: "automation.test", idempotencyKey: "k1" },
    deps
  );
  assert.equal(result.ok && result.duplicate, true);
  assert.deepEqual(seenOrgs, ["org-a"]);
});

test("emitAutomationEvent: crea un evento nuevo cuando corresponde", async () => {
  const result = await emitAutomationEvent(
    { organizationId: "org-a", type: "automation.test", payload: { source: "test" } },
    {
      organizationExists: async () => true,
      findByIdempotencyKey: async () => null,
      createEvent: async (data) => {
        assert.equal(data.organizationId, "org-a");
        assert.equal(data.type, "automation.test");
        return { id: "evt-nuevo" };
      },
      maxAttempts: 5,
    }
  );
  assert.equal(result.ok && result.eventId, "evt-nuevo");
  assert.equal(result.ok && result.duplicate, false);
});

// ============================================================
// Proveedor mock
// ============================================================

test("MockProvider simula éxito, error temporal, error definitivo y callback", async () => {
  const provider = new MockProvider();
  assert.deepEqual(
    { ...(await provider.dispatch(webhook({ payload: { mock: "success" } }))) },
    { ok: true, awaitingCallback: false, externalExecutionId: "mock-evt-1", responseMeta: { simulated: true } }
  );
  const temporary = await provider.dispatch(webhook({ payload: { mock: "temporary_error" } }));
  assert.equal(temporary.ok === false && temporary.retryable, true);
  const permanent = await provider.dispatch(webhook({ payload: { mock: "permanent_error" } }));
  assert.equal(permanent.ok === false && permanent.retryable, false);
  const callback = await provider.dispatch(webhook({ payload: { mock: "callback" } }));
  assert.equal(callback.ok === true && callback.awaitingCallback, true);
});

test("n8n readiness: reconoce solo el probe controlado y bloquea eventos reales", () => {
  const configurationFingerprint = "a".repeat(64);
  assert.equal(
    isN8nConnectionProbeEvent({
      type: "automation.test",
      payload: { source: "connection-test", configurationFingerprint },
    }),
    true
  );
  for (const input of [
    { type: "automation.test", payload: { source: "manual-test" } },
    {
      type: "automation.test",
      payload: { source: "connection-test", configurationFingerprint, extra: true },
    },
    {
      type: "conversation.handoff_requested",
      payload: { source: "connection-test" },
    },
  ]) {
    assert.equal(isN8nConnectionProbeEvent(input), false);
  }

  assert.equal(
    canDispatchN8nEvent({
      connectionProbe: true,
      allowUnverifiedProbe: true,
      organizationReady: false,
    }),
    true
  );
  assert.equal(
    canDispatchN8nEvent({
      connectionProbe: true,
      allowUnverifiedProbe: false,
      organizationReady: true,
    }),
    false
  );
  assert.equal(
    canDispatchN8nEvent({
      connectionProbe: false,
      allowUnverifiedProbe: true,
      organizationReady: false,
    }),
    false
  );
  assert.equal(
    canDispatchN8nEvent({
      connectionProbe: false,
      allowUnverifiedProbe: false,
      organizationReady: true,
    }),
    true
  );
});

test("probe n8n: reutiliza el abierto y encadena la siguiente prueba", () => {
  const fingerprint = "b".repeat(64);
  const now = new Date("2026-07-15T12:00:00.000Z");
  assert.equal(
    n8nProbeIdempotencyKey(null),
    "automation.connection-test:initial"
  );
  assert.notEqual(
    n8nProbeIdempotencyKey(null),
    n8nProbeIdempotencyKey("previous-event")
  );
  assert.equal(
    shouldReuseN8nProbe(
      {
        type: "automation.test",
        payload: { source: "connection-test", configurationFingerprint: fingerprint },
        status: "PROCESSING",
        createdAt: new Date(now.getTime() - 10 * 60_000),
      },
      fingerprint,
      now
    ),
    true
  );
  assert.equal(
    shouldReuseN8nProbe(
      {
        type: "automation.test",
        payload: { source: "connection-test", configurationFingerprint: fingerprint },
        status: "SUCCEEDED",
        createdAt: new Date(now.getTime() - 59_999),
      },
      fingerprint,
      now
    ),
    true
  );
  assert.equal(
    shouldReuseN8nProbe(
      {
        type: "automation.test",
        payload: { source: "connection-test", configurationFingerprint: fingerprint },
        status: "SUCCEEDED",
        createdAt: new Date(now.getTime() - 60_000),
      },
      fingerprint,
      now
    ),
    false
  );
  assert.equal(
    shouldReuseN8nProbe(
      {
        type: "automation.test",
        payload: { source: "connection-test", configurationFingerprint: "c".repeat(64) },
        status: "PROCESSING",
        createdAt: now,
      },
      fingerprint,
      now
    ),
    false
  );
});

test("dispatcher: exige la señal explícita con valor true", () => {
  assert.equal(isDispatcherEnabledSignal("true"), true);
  assert.equal(isDispatcherEnabledSignal(" TRUE "), true);
  for (const value of ["", "false", "1", "yes"]) {
    assert.equal(isDispatcherEnabledSignal(value), false);
  }
});

test("workflows: exige confirmación explícita de publicación", () => {
  assert.equal(isN8nWorkflowsPublishedSignal("true"), true);
  assert.equal(isN8nWorkflowsPublishedSignal(" TRUE "), true);
  for (const value of ["", "false", "1", "yes"]) {
    assert.equal(isN8nWorkflowsPublishedSignal(value), false);
  }
});

test("dispatcher: el secreto no habilita por sí solo el endpoint", () => {
  const previousEnabled = process.env.AUTOMATION_DISPATCHER_ENABLED;
  const previousSecret = process.env.AUTOMATION_CRON_SECRET;
  try {
    process.env.AUTOMATION_CRON_SECRET =
      "dispatcher-test-secret-with-at-least-32-characters";
    process.env.AUTOMATION_DISPATCHER_ENABLED = "false";
    assert.throws(() => getCronSecret());
    process.env.AUTOMATION_DISPATCHER_ENABLED = "true";
    assert.equal(
      getCronSecret(),
      "dispatcher-test-secret-with-at-least-32-characters"
    );
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.AUTOMATION_DISPATCHER_ENABLED;
    } else {
      process.env.AUTOMATION_DISPATCHER_ENABLED = previousEnabled;
    }
    if (previousSecret === undefined) delete process.env.AUTOMATION_CRON_SECRET;
    else process.env.AUTOMATION_CRON_SECRET = previousSecret;
  }
});

// ============================================================
// Callback: idempotencia y estado
// ============================================================

test("resolveCallbackTransition: idempotente (no re-aplica en estado terminal)", () => {
  assert.deepEqual(resolveCallbackTransition("PROCESSING", "succeeded"), {
    apply: true,
    newStatus: "SUCCEEDED",
  });
  assert.deepEqual(resolveCallbackTransition("PROCESSING", "failed"), {
    apply: true,
    newStatus: "FAILED",
  });
  assert.equal(resolveCallbackTransition("SUCCEEDED", "succeeded").apply, false);
  assert.equal(resolveCallbackTransition("DEAD_LETTER", "failed").apply, false);
});

// ============================================================
// Permisos
// ============================================================

test("automation.manage: solo OWNER y ADMIN; rechaza AGENT y VIEWER", () => {
  assert.equal(can("OWNER", "automation.manage"), true);
  assert.equal(can("ADMIN", "automation.manage"), true);
  assert.equal(can("AGENT", "automation.manage"), false);
  assert.equal(can("VIEWER", "automation.manage"), false);
});
