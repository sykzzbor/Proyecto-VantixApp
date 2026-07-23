import { after } from "next/server";
import {
  automationJson,
  readLimitedRawBody,
} from "@/server/automation/http";
import { getWooCommerceWebhookConnection } from "@/server/integrations/woocommerce/service";
import {
  acceptWooCommerceWebhook,
  parseWooCommerceWebhookResourceId,
  processWooCommerceWebhook,
  verifyWooCommerceWebhookSignature,
} from "@/server/integrations/woocommerce/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(
  request: Request,
  context: { params: Promise<{ webhookKey: string }> }
) {
  const { webhookKey } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(webhookKey)) {
    return automationJson({ ok: false }, { status: 404 });
  }
  const body = await readLimitedRawBody(request, 256 * 1024);
  if (!body.ok) {
    return automationJson(
      { ok: false },
      { status: body.reason === "too_large" ? 413 : 400 }
    );
  }
  const connection = await getWooCommerceWebhookConnection(webhookKey);
  if (!connection) return automationJson({ ok: true }, { status: 202 });
  const signature = request.headers.get("x-wc-webhook-signature");
  if (
    !verifyWooCommerceWebhookSignature(
      body.rawBody,
      signature,
      connection.webhookSecret
    )
  ) {
    return automationJson({ ok: false }, { status: 401 });
  }
  const topic = request.headers.get("x-wc-webhook-topic")?.trim() ?? "";
  if (!/^[a-z]+\.(?:created|updated|deleted)$/.test(topic)) {
    return automationJson({ ok: true }, { status: 202 });
  }
  const resourceId = parseWooCommerceWebhookResourceId(body.rawBody);
  if (!resourceId) return automationJson({ ok: false }, { status: 400 });
  const deliveryId =
    request.headers.get("x-wc-delivery-id")?.trim() || null;
  try {
    const accepted = await acceptWooCommerceWebhook({
      webhookKey,
      topic,
      deliveryId,
      resourceId,
      rawBody: body.rawBody,
    });
    if (!accepted.accepted) {
      return automationJson({ ok: false }, { status: 400 });
    }
    if (
      accepted.process &&
      accepted.receiptId &&
      accepted.organizationId
    ) {
      after(() =>
        processWooCommerceWebhook({
          receiptId: accepted.receiptId!,
          organizationId: accepted.organizationId!,
          topic,
          resourceId,
        })
      );
    }
    return automationJson(
      { ok: true, duplicate: accepted.duplicate },
      { status: 202 }
    );
  } catch (error) {
    console.error(
      "[VantixApp] WooCommerce webhook:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson({ ok: false }, { status: 500 });
  }
}
