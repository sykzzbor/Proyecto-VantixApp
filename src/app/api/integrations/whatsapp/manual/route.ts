import { whatsappIntegrationConfigSchema } from "@/lib/validations/whatsapp";
import {
  authorizeWhatsappIntegrationRequest,
  parseWhatsappJson,
  requireSameOrigin,
  whatsappIntegrationJson,
} from "@/server/whatsapp/embedded-signup-http";
import {
  connectManualWhatsapp,
  ManualWhatsappConnectionError,
} from "@/server/whatsapp/manual-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ManualRouteDependencies = {
  authorize: typeof authorizeWhatsappIntegrationRequest;
  connect: typeof connectManualWhatsapp;
};

const defaultDependencies: ManualRouteDependencies = {
  authorize: authorizeWhatsappIntegrationRequest,
  connect: connectManualWhatsapp,
};

export async function handleManualWhatsappConnectionRequest(
  request: Request,
  overrides: Partial<ManualRouteDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const authorization = await dependencies.authorize(
    request,
    "whatsapp.manage"
  );
  if (!authorization.ok) return authorization.response;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const body = await parseWhatsappJson(
    request,
    whatsappIntegrationConfigSchema
  );
  if (!body.ok) return body.response;

  try {
    await dependencies.connect({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
      ...body.data,
    });
    // La respuesta nunca incluye IDs privados, el token ni la credencial cifrada.
    return whatsappIntegrationJson({ ok: true, state: "connected" });
  } catch (error) {
    if (error instanceof ManualWhatsappConnectionError) {
      return whatsappIntegrationJson(
        { error: error.code, message: error.message },
        { status: error.status }
      );
    }
    return whatsappIntegrationJson(
      {
        error: "connection_unavailable",
        message: "No se pudo completar la conexión manual con WhatsApp.",
      },
      { status: 500 }
    );
  }
}

export function POST(request: Request) {
  return handleManualWhatsappConnectionRequest(request);
}
