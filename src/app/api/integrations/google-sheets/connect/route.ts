import { authorizeAutomationRequest, automationJson } from "@/server/automation/http";
import { getGoogleSheetsConfigurationStatus } from "@/server/integrations/google-sheets/config";
import { buildGoogleSheetsAuthUrl } from "@/server/integrations/google-sheets/oauth";
import { createGoogleSheetsOAuthState } from "@/server/integrations/google-sheets/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(request, "integrations.manage", "google_sheets");
  if (!authorization.ok) return authorization.response;
  const configuration = getGoogleSheetsConfigurationStatus();
  if (!configuration.configured) {
    return automationJson({ error: "not_configured", message: configuration.message }, { status: 503 });
  }
  try {
    const state = await createGoogleSheetsOAuthState({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
    });
    return automationJson({ ok: true, url: buildGoogleSheetsAuthUrl(state) });
  } catch (error) {
    console.error("[VantixApp] Google Sheets connect:", error instanceof Error ? error.name : "unknown_error");
    return automationJson({ error: "internal_error", message: "No se pudo iniciar la conexión." }, { status: 500 });
  }
}
