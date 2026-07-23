import { authorizeAutomationRequest, automationJson } from "@/server/automation/http";
import { buildTiendanubeAuthUrl } from "@/server/integrations/tiendanube/api";
import { getTiendanubeConfigurationStatus } from "@/server/integrations/tiendanube/config";
import { createTiendanubeOAuthState } from "@/server/integrations/tiendanube/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(request, "integrations.manage", "tiendanube");
  if (!authorization.ok) return authorization.response;
  const configuration = getTiendanubeConfigurationStatus();
  if (!configuration.configured) {
    return automationJson({ error: "not_configured", message: configuration.message }, { status: 503 });
  }
  try {
    const state = await createTiendanubeOAuthState({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
    });
    return automationJson({ ok: true, url: buildTiendanubeAuthUrl(state) });
  } catch (error) {
    console.error("[VantixApp] Tiendanube connect:", error instanceof Error ? error.name : "unknown_error");
    return automationJson({ error: "internal_error", message: "No se pudo iniciar la conexión con Tiendanube." }, { status: 500 });
  }
}
