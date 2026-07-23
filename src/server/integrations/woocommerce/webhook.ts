import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";
import { hasPlanFeature } from "@/server/billing/rules";
import { WOOCOMMERCE_WEBHOOK_TOPICS } from "@/server/integrations/woocommerce/config";
import {
  getWooCommerceWebhookConnection,
  syncWooCommerceWebhookResource,
} from "@/server/integrations/woocommerce/service";

const SUPPORTED_TOPICS = new Set<string>(WOOCOMMERCE_WEBHOOK_TOPICS);

export function verifyWooCommerceWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest();
  const received = Buffer.from(signature, "base64");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

export function parseWooCommerceWebhookResourceId(
  rawBody: string
): string | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("id" in parsed) ||
      !Number.isInteger((parsed as { id?: unknown }).id) ||
      Number((parsed as { id: number }).id) < 0
    ) {
      return null;
    }
    return String((parsed as { id: number }).id);
  } catch {
    return null;
  }
}

export function buildWooCommerceWebhookDedupeKey(input: {
  webhookKey: string;
  topic: string;
  deliveryId: string | null;
  rawBody: string;
}): string {
  return createHash("sha256")
    .update(
      input.deliveryId
        ? `${input.webhookKey}:${input.topic}:${input.deliveryId}`
        : `${input.webhookKey}:${input.topic}:${input.rawBody}`,
      "utf8"
    )
    .digest("hex");
}

export async function acceptWooCommerceWebhook(input: {
  webhookKey: string;
  topic: string;
  deliveryId: string | null;
  resourceId: string | null;
  rawBody: string;
}): Promise<
  | {
      accepted: true;
      duplicate: boolean;
      receiptId: string | null;
      organizationId: string | null;
      process: boolean;
    }
  | { accepted: false }
> {
  const connection = await getWooCommerceWebhookConnection(input.webhookKey);
  if (!connection) {
    return {
      accepted: true,
      duplicate: false,
      receiptId: null,
      organizationId: null,
      process: false,
    };
  }
  const entitlement = await getOrganizationEntitlement(
    connection.organizationId
  );
  const process =
    connection.connected &&
    entitlement.accessAllowed &&
    hasPlanFeature(entitlement, "woocommerce") &&
    SUPPORTED_TOPICS.has(input.topic) &&
    Boolean(input.resourceId);
  try {
    const receipt = await prisma.wooCommerceWebhookReceipt.create({
      data: {
        organizationId: connection.organizationId,
        webhookKey: input.webhookKey,
        topic: input.topic.slice(0, 80),
        resourceId: input.resourceId,
        deliveryId: input.deliveryId?.slice(0, 100) ?? null,
        dedupeKey: buildWooCommerceWebhookDedupeKey(input),
        processedAt: process ? null : new Date(),
      },
      select: { id: true },
    });
    return {
      accepted: true,
      duplicate: false,
      receiptId: receipt.id,
      organizationId: connection.organizationId,
      process,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        accepted: true,
        duplicate: true,
        receiptId: null,
        organizationId: connection.organizationId,
        process: false,
      };
    }
    throw error;
  }
}

export async function processWooCommerceWebhook(input: {
  receiptId: string;
  organizationId: string;
  topic: string;
  resourceId: string;
}): Promise<void> {
  try {
    await syncWooCommerceWebhookResource({
      organizationId: input.organizationId,
      topic: input.topic,
      resourceId: input.resourceId,
    });
    await prisma.wooCommerceWebhookReceipt.updateMany({
      where: {
        id: input.receiptId,
        organizationId: input.organizationId,
        processedAt: null,
      },
      data: { processedAt: new Date(), lastError: null },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "WooCommerceApiError"
        ? error.message.slice(0, 500)
        : "No se pudo procesar el evento de WooCommerce.";
    await prisma.wooCommerceWebhookReceipt.updateMany({
      where: {
        id: input.receiptId,
        organizationId: input.organizationId,
      },
      data: { lastError: message },
    });
    console.error(
      `[VantixApp] WooCommerce webhook topic=${input.topic} error=${error instanceof Error ? error.name : "unknown_error"}`
    );
  }
}
