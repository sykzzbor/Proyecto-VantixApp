import type { NextRequest } from "next/server";
import { whatsappEmptyMutationSchema } from "@/lib/validations/whatsapp-embedded-signup";
import {
  cancelEmbeddedSignupAttempt,
  EMBEDDED_SIGNUP_COOKIE,
} from "@/server/whatsapp/embedded-signup";
import {
  authorizeWhatsappIntegrationRequest,
  parseWhatsappJson,
  requireSameOrigin,
  whatsappEmbeddedErrorResponse,
  whatsappIntegrationJson,
} from "@/server/whatsapp/embedded-signup-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authorization = await authorizeWhatsappIntegrationRequest(
    request,
    "whatsapp.manage"
  );
  if (!authorization.ok) return authorization.response;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const body = await parseWhatsappJson(request, whatsappEmptyMutationSchema);
  if (!body.ok) return body.response;
  const nonce = request.cookies.get(EMBEDDED_SIGNUP_COOKIE)?.value;
  if (!nonce) {
    return whatsappIntegrationJson({ ok: true, cancelled: false });
  }
  try {
    const cancelled = await cancelEmbeddedSignupAttempt({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
      nonce,
    });
    const response = whatsappIntegrationJson({ ok: true, cancelled });
    response.cookies.delete(EMBEDDED_SIGNUP_COOKIE);
    return response;
  } catch (error) {
    return whatsappEmbeddedErrorResponse(error);
  }
}
