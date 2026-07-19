import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MercadoPagoBillingProvider,
  verifyMercadoPagoWebhookSignature,
} from "@/server/billing/mercado-pago";
import { applyMercadoPagoSubscriptionUpdate } from "@/server/billing/service";
import { ActionError } from "@/server/errors";
import { readLimitedRawBody } from "@/server/automation/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
const webhookSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    type: z.enum([
      "subscription_preapproval",
      "subscription_authorized_payment",
      "subscription_preapproval_plan",
    ]),
    action: z.string().min(1).max(80).optional(),
    date_created: z.string().min(1).max(64).optional(),
    data: z.object({ id: z.union([z.string(), z.number()]) }).passthrough(),
  })
  .passthrough();

function response(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim();
  if (!secret) return response({ error: "not_configured" }, 503);

  const bodyResult = await readLimitedRawBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return response(
      { error: bodyResult.reason === "too_large" ? "payload_too_large" : "invalid_body" },
      bodyResult.reason === "too_large" ? 413 : 400
    );
  }
  const rawBody = bodyResult.rawBody;

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return response({ error: "invalid_body" }, 400);
  }
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) return response({ error: "invalid_body" }, 400);

  const queryDataId = new URL(request.url).searchParams.get("data.id");
  const bodyDataId = String(parsed.data.data.id);
  const dataId = queryDataId ?? bodyDataId;
  if (dataId !== bodyDataId) return response({ error: "invalid_body" }, 400);
  if (
    !verifyMercadoPagoWebhookSignature({
      signatureHeader: request.headers.get("x-signature"),
      requestId: request.headers.get("x-request-id"),
      dataId,
      secret,
    })
  ) {
    return response({ error: "invalid_signature" }, 401);
  }

  try {
    const provider = new MercadoPagoBillingProvider();
    if (parsed.data.type === "subscription_preapproval_plan") {
      return response({ received: true, ignored: true }, 200);
    }
    const authorizedPayment =
      parsed.data.type === "subscription_authorized_payment"
        ? await provider.getAuthorizedPayment(dataId)
        : null;
    const remote = await provider.getSubscription(
      authorizedPayment?.subscriptionId ?? dataId
    );
    const result = await applyMercadoPagoSubscriptionUpdate({
      remote,
      eventType: authorizedPayment
        ? `${parsed.data.type}:${authorizedPayment.paymentStatus}`
        : `${parsed.data.type}:${parsed.data.action ?? "updated"}`,
      payloadHash: createHash("sha256").update(rawBody, "utf8").digest("hex"),
      occurredAt:
        parsed.data.date_created &&
        !Number.isNaN(Date.parse(parsed.data.date_created))
          ? new Date(parsed.data.date_created)
          : null,
      provider,
      chargedAmountArs: authorizedPayment?.amountArs,
      chargedCurrency: authorizedPayment?.currency,
      externalEventId: dataId,
    });
    return response({ received: true, duplicate: result.duplicate }, 200);
  } catch (error) {
    if (error instanceof ActionError) {
      return response({ received: true, ignored: true }, 200);
    }
    console.error(
      "[VantixApp] Mercado Pago webhook:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return response({ error: "provider_unavailable" }, 502);
  }
}
