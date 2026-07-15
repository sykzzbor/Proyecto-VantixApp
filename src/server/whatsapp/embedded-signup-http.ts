import type { ZodType } from "zod";
import type { Permission } from "@/lib/permissions";
import {
  authorizeAutomationRequest,
  automationJson,
  readLimitedRawBody,
} from "@/server/automation/http";
import {
  EMBEDDED_SIGNUP_MAX_BODY_BYTES,
  isSameOriginMutation,
  WhatsappEmbeddedSignupError,
} from "@/server/whatsapp/embedded-signup";

export { automationJson as whatsappIntegrationJson };

export async function authorizeWhatsappIntegrationRequest(
  request: Request,
  permission: Permission
) {
  return authorizeAutomationRequest(request, permission);
}

export function requireSameOrigin(request: Request) {
  if (isSameOriginMutation(request)) return null;
  return automationJson(
    { error: "invalid_origin", message: "El origen de la solicitud no es válido." },
    { status: 403 }
  );
}

export async function parseWhatsappJson<T>(
  request: Request,
  schema: ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const result = await readLimitedRawBody(
    request,
    EMBEDDED_SIGNUP_MAX_BODY_BYTES
  );
  if (!result.ok) {
    return {
      ok: false,
      response: automationJson(
        {
          error:
            result.reason === "too_large" ? "payload_too_large" : "invalid_body",
          message: "El cuerpo de la solicitud no es válido.",
        },
        { status: result.reason === "too_large" ? 413 : 400 }
      ),
    };
  }
  let body: unknown = {};
  if (result.rawBody) {
    try {
      body = JSON.parse(result.rawBody) as unknown;
    } catch {
      return {
        ok: false,
        response: automationJson(
          { error: "invalid_body", message: "El cuerpo de la solicitud no es válido." },
          { status: 400 }
        ),
      };
    }
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: automationJson(
        { error: "invalid_body", message: "Los datos enviados no son válidos." },
        { status: 400 }
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

export function whatsappEmbeddedErrorResponse(error: unknown): Response {
  if (error instanceof WhatsappEmbeddedSignupError) {
    return automationJson(
      { error: error.code, message: error.message },
      { status: error.status }
    );
  }
  return automationJson(
    {
      error: "connection_unavailable",
      message: "No se pudo completar la operación con WhatsApp.",
    },
    { status: 500 }
  );
}
