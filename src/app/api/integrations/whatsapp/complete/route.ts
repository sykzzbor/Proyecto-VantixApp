import type { NextRequest } from "next/server";
import { whatsappEmbeddedSignupCompleteSchema } from "@/lib/validations/whatsapp-embedded-signup";
import {
  completeEmbeddedSignup,
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
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const authorization = await authorizeWhatsappIntegrationRequest(
    request,
    "whatsapp.manage"
  );
  if (!authorization.ok) return authorization.response;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const body = await parseWhatsappJson(
    request,
    whatsappEmbeddedSignupCompleteSchema
  );
  if (!body.ok) return body.response;
  const nonce = request.cookies.get(EMBEDDED_SIGNUP_COOKIE)?.value;
  if (!nonce) {
    return whatsappIntegrationJson(
      {
        error: "invalid_signup_state",
        message: "La sesión de conexión venció o no es válida.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await completeEmbeddedSignup({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
      nonce,
      code: body.data.code,
    });
    if (result.state === "processing") {
      return whatsappIntegrationJson(
        { ok: true, state: "processing" },
        { status: 202 }
      );
    }
    const response = whatsappIntegrationJson({
      ok: true,
      state: result.state,
      integration: result.integration,
    });
    response.cookies.delete(EMBEDDED_SIGNUP_COOKIE);
    return response;
  } catch (error) {
    return whatsappEmbeddedErrorResponse(error);
  }
}
