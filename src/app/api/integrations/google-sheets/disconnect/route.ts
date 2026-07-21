import { authorizeAutomationRequest, automationJson } from "@/server/automation/http";
import { disconnectGoogleSheets } from "@/server/integrations/google-sheets/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(request, "integrations.manage");
  if (!authorization.ok) return authorization.response;
  try {
    const result = await disconnectGoogleSheets({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
    });
    if (!result.ok) return automationJson({ error: "not_connected", message: "Google Sheets no está conectado." }, { status: 409 });
    return automationJson({ ok: true });
  } catch (error) {
    console.error("[VantixApp] Google Sheets disconnect:", error instanceof Error ? error.name : "unknown_error");
    return automationJson({ error: "internal_error", message: "No se pudo desconectar Google Sheets." }, { status: 500 });
  }
}
