import { after } from "next/server";
import { z } from "zod";
import {
  getN8nConfigurationFingerprint,
  getN8nConfigurationState,
} from "@/server/automation/config";
import { emitAutomationEvent } from "@/server/automation/events";
import {
  authorizeAutomationRequest,
  automationJson,
  readLimitedRawBody,
} from "@/server/automation/http";
import { processN8nConnectionProbeNow } from "@/server/automation/queue";
import { recordAudit } from "@/server/audit";
import { prisma } from "@/lib/prisma";
import { getN8nConnectionProbeFingerprint } from "@/server/automation/providers/n8n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emptyBodySchema = z.object({}).strict();
const PROBE_IDEMPOTENCY_WINDOW_MS = 60_000;
const OPEN_PROBE_STATUSES = new Set(["PENDING", "PROCESSING"]);

export function n8nProbeIdempotencyKey(previousEventId: string | null): string {
  return `automation.connection-test:${previousEventId ?? "initial"}`;
}

export function shouldReuseN8nProbe(
  candidate: {
    type: string;
    payload: unknown;
    status: string;
    createdAt: Date;
  } | null,
  fingerprint: string,
  now = new Date()
): boolean {
  if (
    !candidate ||
    getN8nConnectionProbeFingerprint(candidate) !== fingerprint
  ) {
    return false;
  }
  return (
    OPEN_PROBE_STATUSES.has(candidate.status) ||
    candidate.createdAt.getTime() >
      now.getTime() - PROBE_IDEMPOTENCY_WINDOW_MS
  );
}

export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(
    request,
    "automation.manage"
  );
  if (!authorization.ok) return authorization.response;

  let body: unknown = {};
  const bodyResult = await readLimitedRawBody(request, 1024);
  if (!bodyResult.ok) {
    return automationJson(
      {
        error:
          bodyResult.reason === "too_large"
            ? "payload_too_large"
            : "invalid_body",
        message: "El cuerpo no es válido.",
      },
      { status: bodyResult.reason === "too_large" ? 413 : 400 }
    );
  }
  const rawBody = bodyResult.rawBody;
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return automationJson(
        { error: "invalid_body", message: "El cuerpo no es válido." },
        { status: 400 }
      );
    }
  }
  if (!emptyBodySchema.safeParse(body).success) {
    return automationJson(
      { error: "invalid_body", message: "Esta prueba no acepta parámetros." },
      { status: 400 }
    );
  }
  const configuration = getN8nConfigurationState();
  if (!configuration.complete) {
    return automationJson(
      {
        error: "incomplete_integration",
        message: "La integración de n8n todavía está incompleta.",
        missing: configuration.missing,
      },
      { status: 409 }
    );
  }

  const configurationFingerprint = getN8nConfigurationFingerprint();
  if (!configurationFingerprint) {
    return automationJson(
      {
        error: "incomplete_integration",
        message: "La integración de n8n todavía está incompleta.",
      },
      { status: 409 }
    );
  }
  const now = new Date();
  const previousProbe = await prisma.automationEvent.findFirst({
    where: {
      organizationId: authorization.ctx.organizationId,
      type: "automation.test",
      payload: { path: ["source"], equals: "connection-test" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      payload: true,
      status: true,
      createdAt: true,
    },
  });

  const result = shouldReuseN8nProbe(
    previousProbe,
    configurationFingerprint,
    now
  )
    ? {
        ok: true as const,
        eventId: previousProbe!.id,
        duplicate: true,
      }
    : await emitAutomationEvent({
        organizationId: authorization.ctx.organizationId,
        type: "automation.test",
        payload: {
          source: "connection-test",
          configurationFingerprint,
        },
        idempotencyKey: n8nProbeIdempotencyKey(previousProbe?.id ?? null),
      });
  if (!result.ok) {
    return automationJson(
      { error: result.code, message: "No se pudo crear la prueba de conexión." },
      { status: 400 }
    );
  }

  // Un probe nunca se reintenta automáticamente: ante ambigüedad se prioriza
  // no enviar de nuevo. La cadena por evento previo absorbe concurrencia incluso
  // al cruzar un límite temporal, y un probe abierto siempre se reutiliza.
  await prisma.automationEvent.updateMany({
    where: {
      id: result.eventId,
      organizationId: authorization.ctx.organizationId,
      type: "automation.test",
      status: "PENDING",
    },
    data: { maxAttempts: 1 },
  });
  const probe = await prisma.automationEvent.findFirst({
    where: {
      id: result.eventId,
      organizationId: authorization.ctx.organizationId,
      type: "automation.test",
    },
    select: { status: true },
  });
  if (!probe) {
    return automationJson(
      { error: "not_found", message: "No se pudo preparar la prueba." },
      { status: 404 }
    );
  }
  await recordAudit({
    organizationId: authorization.ctx.organizationId,
    userId: authorization.ctx.userId,
    action: "automation.connection_test_emitted",
    entityType: "automation_event",
    entityId: result.eventId,
    details: { duplicate: result.duplicate },
  });

  if (probe.status === "PENDING") {
    after(async () => {
      await processN8nConnectionProbeNow({
        eventId: result.eventId,
        organizationId: authorization.ctx.organizationId,
      });
    });
  }
  if (["FAILED", "DEAD_LETTER", "CANCELLED"].includes(probe.status)) {
    return automationJson(
      {
        error: "probe_failed",
        message: "La última prueba no se completó. Volvé a intentar en un minuto.",
        eventId: result.eventId,
      },
      { status: 409 }
    );
  }
  return automationJson({
    ok: true,
    eventId: result.eventId,
    duplicate: result.duplicate,
    state: probe.status === "SUCCEEDED" ? "verified" : "awaiting_callback",
  });
}
