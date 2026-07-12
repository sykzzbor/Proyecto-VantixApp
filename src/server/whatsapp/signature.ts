import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  getMetaAppSecret,
  getWhatsappVerifyToken,
} from "@/server/whatsapp/config";

export type RawWebhookBody = string | ArrayBuffer | Uint8Array;

function bodyToBuffer(rawBody: RawWebhookBody): Buffer {
  if (typeof rawBody === "string") return Buffer.from(rawBody, "utf8");
  if (rawBody instanceof ArrayBuffer) return Buffer.from(rawBody);
  return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/** Valida hub.verify_token sin comparar secretos directamente. */
export function verifyWhatsappVerifyToken(
  receivedToken: string | null | undefined,
  expectedToken = getWhatsappVerifyToken()
): boolean {
  if (!receivedToken || !expectedToken) return false;
  return constantTimeTextEqual(receivedToken, expectedToken);
}

/** Valida X-Hub-Signature-256 contra los bytes exactos del body recibido. */
export function verifyWhatsappSignature(
  rawBody: RawWebhookBody,
  signatureHeader: string | null | undefined,
  appSecret = getMetaAppSecret()
): boolean {
  if (!signatureHeader || !appSecret) return false;

  const match = /^sha256=([a-f0-9]{64})$/i.exec(signatureHeader.trim());
  if (!match?.[1]) return false;

  const received = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", appSecret)
    .update(bodyToBuffer(rawBody))
    .digest();

  return received.length === expected.length && timingSafeEqual(received, expected);
}

// Aliases breves para el Route Handler.
export const verifyWebhookToken = verifyWhatsappVerifyToken;
export const verifyWebhookSignature = verifyWhatsappSignature;
