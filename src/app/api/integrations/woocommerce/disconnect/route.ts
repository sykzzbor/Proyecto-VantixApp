import {
  authorizeAutomationRequest,
  automationJson,
} from "@/server/automation/http";
import { disconnectWooCommerce } from "@/server/integrations/woocommerce/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(
    request,
    "integrations.manage",
    "woocommerce"
  );
  if (!authorization.ok) return authorization.response;
  try {
    const result = await disconnectWooCommerce({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
    });
    if (!result.ok) {
      return automationJson(
        {
          error: "not_connected",
          message: "WooCommerce no está conectado.",
        },
        { status: 409 }
      );
    }
    return automationJson({ ok: true });
  } catch (error) {
    console.error(
      "[VantixApp] WooCommerce disconnect:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      {
        error: "internal_error",
        message: "No se pudo desconectar WooCommerce.",
      },
      { status: 500 }
    );
  }
}
