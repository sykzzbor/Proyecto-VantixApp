import {
  authorizeAutomationRequest,
  automationJson,
} from "@/server/automation/http";
import { disconnectGoogleCalendar } from "@/server/integrations/google-calendar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Desconecta Google Calendar: revoca y elimina los tokens (solo OWNER/ADMIN). */
export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(
    request,
    "integrations.manage"
  );
  if (!authorization.ok) return authorization.response;

  try {
    const result = await disconnectGoogleCalendar({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
    });
    if (!result.ok) {
      return automationJson(
        { error: result.code, message: "Google Calendar no está conectado." },
        { status: 409 }
      );
    }
    return automationJson({ ok: true });
  } catch (error) {
    console.error(
      "[VantixApp] Google Calendar disconnect:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      { error: "internal_error", message: "No se pudo desconectar la cuenta." },
      { status: 500 }
    );
  }
}
