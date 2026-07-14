import { NextResponse } from "next/server";
import { applyAutomationCallback } from "@/server/automation/callback";
import {
  n8nCallbackSchema,
  signedTimestampMatches,
} from "@/lib/validations/automation-webhooks";
import { getN8nCallbackSecret } from "@/server/automation/config";
import { CALLBACK_TIMESTAMP_TOLERANCE_MS } from "@/server/automation/constants";
import {
  isTimestampFresh,
  verifyAutomationSignature,
} from "@/server/automation/signature";
import { readLimitedRawBody } from "@/server/automation/http";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  let secret: string;
  try {
    secret = getN8nCallbackSecret();
  } catch {
    return json(503, { error: "not_configured" });
  }

  // 1. Cuerpo crudo, sin parsear, para verificar la firma sobre los bytes exactos.
  const bodyResult = await readLimitedRawBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return json(bodyResult.reason === "too_large" ? 413 : 400, {
      error:
        bodyResult.reason === "too_large"
          ? "payload_too_large"
          : "invalid_body",
    });
  }
  const rawBody = bodyResult.rawBody;

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
  const validated = n8nCallbackSchema.safeParse(parsed);
  if (!validated.success) {
    return json(400, { error: "invalid_body" });
  }
  if (!signedTimestampMatches(validated.data.timestamp, timestamp)) {
    return json(401, { error: "timestamp_mismatch" });
  }

  // 5. Aplicar (aislado por organización, idempotente, sin confiar en el estado).
  try {
    const result = await applyAutomationCallback(validated.data);
    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : 409;
      return json(status, { error: result.code });
    }
    return json(200, { ok: true, applied: result.applied });
  } catch (error) {
    console.error(
      "[VantixApp] callback n8n:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return json(500, { error: "internal_error" });
  }
}
