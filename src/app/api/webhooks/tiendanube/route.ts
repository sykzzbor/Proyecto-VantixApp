import { after } from "next/server";
import { automationJson, readLimitedRawBody } from "@/server/automation/http";
import {
  acceptTiendanubeWebhook,
  parseTiendanubeWebhook,
  processTiendanubeWebhook,
  verifyTiendanubeWebhookSignature,
} from "@/server/integrations/tiendanube/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const body = await readLimitedRawBody(request, 32 * 1024);
  if (!body.ok) return automationJson({ ok: false }, { status: body.reason === "too_large" ? 413 : 400 });
  const signature = request.headers.get("x-linkedstore-hmac-sha256");
  let valid = false;
  try { valid = verifyTiendanubeWebhookSignature(body.rawBody, signature); } catch { valid = false; }
  if (!valid || !signature) return automationJson({ ok: false }, { status: 401 });
  const payload = parseTiendanubeWebhook(body.rawBody);
  if (!payload) return automationJson({ ok: false }, { status: 400 });
  try {
    const accepted = await acceptTiendanubeWebhook({ rawBody: body.rawBody, signature, payload });
    if (!accepted.accepted) return automationJson({ ok: false }, { status: 400 });
    if (accepted.process && accepted.receiptId && accepted.organizationId) {
      after(() => processTiendanubeWebhook({ receiptId: accepted.receiptId!, organizationId: accepted.organizationId!, payload }));
    }
    return automationJson({ ok: true, duplicate: accepted.duplicate }, { status: 202 });
  } catch (error) {
    console.error("[VantixApp] Tiendanube webhook:", error instanceof Error ? error.name : "unknown_error");
    return automationJson({ ok: false }, { status: 500 });
  }
}
