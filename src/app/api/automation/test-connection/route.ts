import { after } from "next/server";
import { z } from "zod";
import { getAutomationProviderMode, getN8nConfigurationState } from "@/server/automation/config";
import { emitAutomationEvent } from "@/server/automation/events";
import {
  authorizeAutomationRequest,
  automationJson,
  readLimitedRawBody,
} from "@/server/automation/http";
import { processAutomationEventNow } from "@/server/automation/queue";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emptyBodySchema = z.object({}).strict();

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
  if (getAutomationProviderMode() !== "n8n") {
    return automationJson(
      {
        error: "mock_mode",
        message: "El modo de prueba está activo; todavía no se envía a n8n.",
      },
      { status: 409 }
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

  const result = await emitAutomationEvent({
    organizationId: authorization.ctx.organizationId,
    type: "automation.test",
    payload: { source: "connection-test" },
  });
  if (!result.ok) {
    return automationJson(
      { error: result.code, message: "No se pudo crear la prueba de conexión." },
      { status: 400 }
    );
  }
  await recordAudit({
    organizationId: authorization.ctx.organizationId,
    userId: authorization.ctx.userId,
    action: "automation.connection_test_emitted",
    entityType: "automation_event",
    entityId: result.eventId,
  });
  after(async () => {
    await processAutomationEventNow({
      eventId: result.eventId,
      organizationId: authorization.ctx.organizationId,
    });
  });
  return automationJson({
    ok: true,
    eventId: result.eventId,
    state: "awaiting_callback",
  });
}
