import { whatsappEmptyMutationSchema } from "@/lib/validations/whatsapp-embedded-signup";
import { disconnectEmbeddedWhatsapp } from "@/server/whatsapp/embedded-signup";
import {
  authorizeWhatsappIntegrationRequest,
  parseWhatsappJson,
  requireSameOrigin,
  whatsappEmbeddedErrorResponse,
  whatsappIntegrationJson,
} from "@/server/whatsapp/embedded-signup-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorization = await authorizeWhatsappIntegrationRequest(
    request,
    "whatsapp.manage"
  );
  if (!authorization.ok) return authorization.response;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const body = await parseWhatsappJson(request, whatsappEmptyMutationSchema);
  if (!body.ok) return body.response;
  try {
    await disconnectEmbeddedWhatsapp({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
    });
    return whatsappIntegrationJson({ ok: true, state: "disconnected" });
  } catch (error) {
    return whatsappEmbeddedErrorResponse(error);
  }
}
