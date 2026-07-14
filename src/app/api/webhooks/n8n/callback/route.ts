import { NextResponse } from "next/server";
import { z } from "zod";
import { applyAutomationCallback } from "@/server/automation/callback";
import { getN8nCallbackSecret } from "@/server/automation/config";
import { CALLBACK_TIMESTAMP_TOLERANCE_MS } from "@/server/automation/constants";
import {
  isTimestampFresh,
  verifyAutomationSignature,
} from "@/server/automation/signature";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

const callbackSchema = z.object({
  eventId: z.string().min(1).max(64),
  organizationId: z.string().min(1).max(64),
  status: z.enum(["succeeded", "failed"]),
  externalExecutionId: z.string().max(200).nullish(),
  errorCode: z.string().max(120).nullish(),
  errorMessage: z.string().max(500).nullish(),
  responseMeta: z.record(z.string(), z.unknown()).nullish(),
});

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  let secret: string;
  try {
    secret = getN8nCallbackSecret();
  } catch {
    return json(503, { error: "not_configured" });
  }

  // 1. Cuerpo crudo, sin parsear, para verificar la firma sobre los bytes exactos.
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return json(413, { error: "payload_too_large" });
  }

  // 2. Firma HMAC.
  const signature = request.headers.get("x-vantix-signature");
  if (!verifyAutomationSignature(rawBody, signature, secret)) {
    return json(401, { error: "invalid_signature" });
  }

  // 3. Timestamp fresco (anti-replay).
  const timestamp = request.headers.get("x-vantix-timestamp");
  if (!isTimestampFresh(timestamp, CALLBACK_TIMESTAMP_TOLERANCE_MS)) {
    return json(401, { error: "stale_timestamp" });
  }

  // 4. Cuerpo válido.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const validated = callbackSchema.safeParse(parsed);
  if (!validated.success) {
    return json(400, { error: "invalid_body" });
  }

  // 5. Aplicar (aislado por organización, idempotente, sin confiar en el estado).
  try {
    const result = await applyAutomationCallback(validated.data);
    if (!result.ok) return json(404, { error: "event_not_found" });
    return json(200, { ok: true, applied: result.applied });
  } catch (error) {
    console.error(
      "[VantixApp] callback n8n:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return json(500, { error: "internal_error" });
  }
}
