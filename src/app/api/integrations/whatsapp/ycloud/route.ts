import { ycloudConnectionSchema } from "@/lib/validations/whatsapp";
import {
  authorizeWhatsappIntegrationRequest,
  parseWhatsappJson,
  requireSameOrigin,
  whatsappIntegrationJson,
} from "@/server/whatsapp/embedded-signup-http";
import {
  connectYCloudWhatsapp,
  YCloudConnectionError,
} from "@/server/whatsapp/ycloud-connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteDependencies = {
  authorize: typeof authorizeWhatsappIntegrationRequest;
  connect: typeof connectYCloudWhatsapp;
};

const defaultDependencies: RouteDependencies = {
  authorize: authorizeWhatsappIntegrationRequest,
  connect: connectYCloudWhatsapp,
};

export async function handleYCloudConnectionRequest(
  request: Request,
  overrides: Partial<RouteDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...overrides };
  const authorization = await dependencies.authorize(request, "whatsapp.manage");
  if (!authorization.ok) return authorization.response;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const body = await parseWhatsappJson(request, ycloudConnectionSchema);
  if (!body.ok) return body.response;

  try {
    await dependencies.connect({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
      ...body.data,
    });
    return whatsappIntegrationJson({ ok: true, state: "connected" });
  } catch (error) {
    if (error instanceof YCloudConnectionError) {
      return whatsappIntegrationJson(
        { error: error.code, message: error.message },
        { status: error.status }
      );
    }
    return whatsappIntegrationJson(
      {
        error: "connection_unavailable",
        message: "No se pudo completar la conexión con YCloud.",
      },
      { status: 500 }
    );
  }
}

export function POST(request: Request) {
  return handleYCloudConnectionRequest(request);
}
