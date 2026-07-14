import { after } from "next/server";
import { automationTestBodySchema } from "@/lib/validations/automation";
import { emitAutomationEvent } from "@/server/automation/events";
import {
  authorizeAutomationRequest,
  automationJson,
} from "@/server/automation/http";
import { processDueAutomationEvents } from "@/server/automation/queue";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Genera un evento `automation.test` para probar toda la infraestructura.
 * Solo OWNER/ADMIN de la organización de la sesión. La organización se resuelve
 * SIEMPRE desde la membresía del usuario, nunca del cuerpo de la petición.
 */
export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(request, "automation.manage");
  if (!authorization.ok) return authorization.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return automationJson(
      { error: "invalid_body", message: "El cuerpo no es válido." },
      { status: 400 }
    );
  }
  const parsed = automationTestBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return automationJson(
      { error: "invalid_body", message: "Elegí un resultado de prueba válido." },
      { status: 400 }
    );
  }

  const result = await emitAutomationEvent({
    organizationId: authorization.ctx.organizationId,
    type: "automation.test",
    payload: { source: "manual-test", mock: parsed.data.mock },
  });
  if (!result.ok) {
    return automationJson(
      { error: result.code, message: "No se pudo crear el evento de prueba." },
      { status: 400 }
    );
  }

  await recordAudit({
    organizationId: authorization.ctx.organizationId,
    userId: authorization.ctx.userId,
    action: "automation.test_emitted",
    entityType: "automation_event",
    entityId: result.eventId,
    details: { duplicate: result.duplicate },
  });

  // Procesa el evento fuera del render (no bloquea la respuesta).
  after(async () => {
    await processDueAutomationEvents();
  });

  return automationJson({
    ok: true,
    eventId: result.eventId,
    duplicate: result.duplicate,
  });
}
