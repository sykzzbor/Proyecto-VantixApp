import {
  authorizeAutomationRequest,
  automationJson,
} from "@/server/automation/http";
import { GoogleApiError } from "@/server/integrations/google-calendar/oauth";
import { listGoogleCalendars } from "@/server/integrations/google-calendar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lista los calendarios de la cuenta conectada (solo OWNER/ADMIN). */
export async function GET(request: Request) {
  const authorization = await authorizeAutomationRequest(
    request,
    "integrations.manage"
  );
  if (!authorization.ok) return authorization.response;

  try {
    const calendars = await listGoogleCalendars(
      authorization.ctx.organizationId
    );
    return automationJson({ ok: true, calendars });
  } catch (error) {
    if (error instanceof GoogleApiError) {
      return automationJson(
        { error: error.code, message: error.safeMessage },
        { status: error.code === "not_configured" ? 409 : 502 }
      );
    }
    console.error(
      "[VantixApp] Google Calendar calendars:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      { error: "internal_error", message: "No se pudieron listar los calendarios." },
      { status: 500 }
    );
  }
}
