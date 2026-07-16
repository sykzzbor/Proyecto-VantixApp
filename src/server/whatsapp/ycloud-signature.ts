import { createHmac, timingSafeEqual } from "node:crypto";
import { getYCloudWebhookSecret } from "@/server/whatsapp/config";

export const YCLOUD_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;
const TIMESTAMP_PATTERN = /^\d{10,12}$/;

function safeHexEqual(left: string, right: string): boolean {
  if (!SIGNATURE_PATTERN.test(left) || !SIGNATURE_PATTERN.test(right)) {
    return false;
  }
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function verifyYCloudWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  options: {
    secret?: string;
    now?: Date;
    toleranceSeconds?: number;
  } = {}
): boolean {
  if (!signatureHeader || signatureHeader.length > 1024) return false;
  const timestamps: string[] = [];
  const signatures: string[] = [];
  for (const rawPart of signatureHeader.split(",")) {
    const separator = rawPart.indexOf("=");
    if (separator <= 0) continue;
    const key = rawPart.slice(0, separator).trim();
    const value = rawPart.slice(separator + 1).trim();
    if (key === "t") timestamps.push(value);
    if (key === "s") signatures.push(value.toLowerCase());
  }
  if (timestamps.length !== 1 || signatures.length === 0) return false;
  const timestamp = timestamps[0]!;
  if (!TIMESTAMP_PATTERN.test(timestamp)) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) return false;
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const tolerance =
    options.toleranceSeconds ?? YCLOUD_SIGNATURE_TOLERANCE_SECONDS;
  if (
    !Number.isFinite(tolerance) ||
    tolerance < 0 ||
    Math.abs(nowSeconds - timestampSeconds) > tolerance
  ) {
    return false;
  }
  const secret = options.secret ?? getYCloudWebhookSecret();
  if (secret.length < 16 || secret.length > 512) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return signatures.some((signature) => safeHexEqual(signature, expected));
}
