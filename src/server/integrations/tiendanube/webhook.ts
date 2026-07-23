import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";
import { hasPlanFeature } from "@/server/billing/rules";
import { getTiendanubeClientSecret, TIENDANUBE_WEBHOOK_EVENTS } from "@/server/integrations/tiendanube/config";
import { syncTiendanubeWebhookResource } from "@/server/integrations/tiendanube/service";

const idSchema = z.union([z.string().min(1).max(64), z.number().int().nonnegative()]).transform(String);
const payloadSchema = z.object({
  store_id: idSchema,
  event: z.string().min(1).max(80),
  id: idSchema.optional(),
}).passthrough();

export type TiendanubeWebhookPayload = z.infer<typeof payloadSchema>;

export function verifyTiendanubeWebhookSignature(rawBody: string, signature: string | null, secret = getTiendanubeClientSecret()): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function parseTiendanubeWebhook(rawBody: string): TiendanubeWebhookPayload | null {
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(rawBody) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function buildTiendanubeWebhookDedupeKey(rawBody: string, signature: string, now = new Date()): string {
  const fiveMinuteBucket = Math.floor(now.getTime() / (5 * 60 * 1000));
  return createHash("sha256").update(`${signature}:${fiveMinuteBucket}:${rawBody}`, "utf8").digest("hex");
}

export async function acceptTiendanubeWebhook(input: {
  rawBody: string;
  signature: string;
  payload: TiendanubeWebhookPayload;
  now?: Date;
}): Promise<
  | { accepted: true; duplicate: boolean; receiptId: string | null; organizationId: string | null; process: boolean }
  | { accepted: false }
> {
  const now = input.now ?? new Date();
  const connection = await prisma.tiendanubeConnection.findUnique({
    where: { storeId: input.payload.store_id },
    select: { organizationId: true, status: true },
  });
  if (!connection) return { accepted: true, duplicate: false, receiptId: null, organizationId: null, process: false };
  const entitlement = await getOrganizationEntitlement(connection.organizationId);
  const supported = (TIENDANUBE_WEBHOOK_EVENTS as readonly string[]).includes(input.payload.event);
  const process = entitlement.accessAllowed && hasPlanFeature(entitlement, "tiendanube") && supported;
  try {
    const receipt = await prisma.tiendanubeWebhookReceipt.create({
      data: {
        organizationId: connection.organizationId,
        storeId: input.payload.store_id,
        event: input.payload.event,
        resourceId: input.payload.id ?? null,
        dedupeKey: buildTiendanubeWebhookDedupeKey(input.rawBody, input.signature, now),
        processedAt: process ? null : now,
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { accepted: true, duplicate: true, receiptId: null, organizationId: connection.organizationId, process: false };
    }
    throw error;
  }
}

export async function processTiendanubeWebhook(input: {
  receiptId: string;
  organizationId: string;
  payload: TiendanubeWebhookPayload;
}): Promise<void> {
  try {
    await syncTiendanubeWebhookResource({
      organizationId: input.organizationId,
      event: input.payload.event,
      resourceId: input.payload.id ?? null,
    });
    await prisma.tiendanubeWebhookReceipt.updateMany({
      where: { id: input.receiptId, organizationId: input.organizationId, processedAt: null },
      data: { processedAt: new Date(), lastError: null },
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "TiendanubeApiError"
      ? error.message.slice(0, 500)
      : "No se pudo procesar el evento de Tiendanube.";
    await prisma.tiendanubeWebhookReceipt.updateMany({
      where: { id: input.receiptId, organizationId: input.organizationId },
      data: { lastError: message },
    });
    console.error(`[VantixApp] Tiendanube webhook event=${input.payload.event} error=${error instanceof Error ? error.name : "unknown_error"}`);
  }
}
