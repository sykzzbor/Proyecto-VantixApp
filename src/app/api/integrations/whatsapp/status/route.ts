import { getSafeWhatsappConnectionStatus } from "@/server/whatsapp/embedded-signup";
import {
  authorizeWhatsappIntegrationRequest,
  whatsappIntegrationJson,
} from "@/server/whatsapp/embedded-signup-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await authorizeWhatsappIntegrationRequest(
    request,
    "automation.view"
  );
  if (!authorization.ok) return authorization.response;
  const status = await getSafeWhatsappConnectionStatus(
    authorization.ctx.organizationId
  );
  return whatsappIntegrationJson(status);
}
