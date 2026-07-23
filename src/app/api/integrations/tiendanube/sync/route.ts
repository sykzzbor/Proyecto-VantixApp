import { z } from "zod";
import { ActionError } from "@/server/errors";
import { authorizeAutomationRequest, automationJson, readLimitedRawBody } from "@/server/automation/http";
import { TiendanubeApiError } from "@/server/integrations/tiendanube/api";
import { syncTiendanube } from "@/server/integrations/tiendanube/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({ idempotencyKey: z.uuid() }).strict();

export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(request, "integrations.manage", "tiendanube");
  if (!authorization.ok) return authorization.response;
  const body = await readLimitedRawBody(request, 1024);
  if (!body.ok) return automationJson({ error: "invalid_body", message: "La solicitud no es válida." }, { status: body.reason === "too_large" ? 413 : 400 });
  let raw: unknown;
  try { raw = JSON.parse(body.rawBody) as unknown; } catch { raw = null; }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return automationJson({ error: "invalid_body", message: "La solicitud no es válida." }, { status: 400 });
  try {
    const result = await syncTiendanube({ organizationId: authorization.ctx.organizationId, userId: authorization.ctx.userId, idempotencyKey: parsed.data.idempotencyKey });
    return automationJson({ ok: true, ...result });
  } catch (error) {
    if (error instanceof TiendanubeApiError) return automationJson({ error: error.code, message: error.safeMessage }, { status: 502 });
    if (error instanceof ActionError) return automationJson({ error: "sync_unavailable", message: error.message }, { status: 409 });
    console.error("[VantixApp] Tiendanube sync:", error instanceof Error ? error.name : "unknown_error");
    return automationJson({ error: "internal_error", message: "No se pudo sincronizar Tiendanube." }, { status: 500 });
  }
}
