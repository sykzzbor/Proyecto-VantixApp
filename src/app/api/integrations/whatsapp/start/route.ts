import type { NextRequest } from "next/server";
import { getMetaEmbeddedSignupPublicConfiguration } from "@/server/whatsapp/config";
import {
  EMBEDDED_SIGNUP_COOKIE,
  startEmbeddedSignup,
} from "@/server/whatsapp/embedded-signup";
import {
  authorizeWhatsappIntegrationRequest,
  parseWhatsappJson,
  requireSameOrigin,
  whatsappEmbeddedErrorResponse,
  whatsappIntegrationJson,
} from "@/server/whatsapp/embedded-signup-http";
import { whatsappEmptyMutationSchema } from "@/lib/validations/whatsapp-embedded-signup";

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

  try {
    const result = await startEmbeddedSignup({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
      currentNonce: request.cookies.get(EMBEDDED_SIGNUP_COOKIE)?.value,
    });
    if (result.state === "in_progress") {
      return whatsappIntegrationJson(
        {
          error: "signup_in_progress",
          message: "Ya hay una conexión de WhatsApp en curso.",
        },
        { status: 409 }
      );
    }
    const configuration = getMetaEmbeddedSignupPublicConfiguration();
    const response = whatsappIntegrationJson({
      ok: true,
      state: "ready",
      configuration: {
        appId: configuration.appId,
        configurationId: configuration.configurationId,
        graphApiVersion: configuration.graphApiVersion,
      },
    });
    if (result.nonce) {
      response.cookies.set(EMBEDDED_SIGNUP_COOKIE, result.nonce, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 10 * 60,
      });
    }
    return response;
  } catch (error) {
    return whatsappEmbeddedErrorResponse(error);
  }
}
