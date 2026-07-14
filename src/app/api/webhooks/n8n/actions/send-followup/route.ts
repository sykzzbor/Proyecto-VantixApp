import { NextResponse } from "next/server";
import { executeFollowUpAction } from "@/server/automation/follow-up-action";
import {
  n8nFollowUpActionSchema,
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
export const dynamic = "force-dynamic";

const MAX_ACTION_BODY_BYTES = 4 * 1024;
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

  const bodyResult = await readLimitedRawBody(request, MAX_ACTION_BODY_BYTES);
  if (!bodyResult.ok) {
    return json(bodyResult.reason === "too_large" ? 413 : 400, {
      error:
        bodyResult.reason === "too_large"
          ? "payload_too_large"
          : "invalid_body",
    });
  }
  const rawBody = bodyResult.rawBody;
  if (
    !verifyAutomationSignature(
      rawBody,
      request.headers.get("x-vantix-signature"),
      secret
    )
  ) {
    return json(401, { error: "invalid_signature" });
  }
  const timestampHeader = request.headers.get("x-vantix-timestamp");
  if (
    !isTimestampFresh(
      timestampHeader,
      CALLBACK_TIMESTAMP_TOLERANCE_MS
    )
  ) {
    return json(401, { error: "stale_timestamp" });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const parsed = n8nFollowUpActionSchema.safeParse(body);
  if (!parsed.success) return json(400, { error: "invalid_body" });
  if (!signedTimestampMatches(parsed.data.timestamp, timestampHeader)) {
    return json(401, { error: "timestamp_mismatch" });
  }

  const result = await executeFollowUpAction(parsed.data);
  if (result.ok) {
    return json(200, {
      ok: true,
      state: result.state,
      duplicate: result.duplicate,
      callbackRequired: result.callbackRequired,
      ...("nextAttemptAt" in result
        ? { nextAttemptAt: result.nextAttemptAt }
        : {}),
    });
  }
  const status =
    result.code === "not_found"
      ? 404
      : result.code === "not_executable" || result.code === "in_progress"
        ? 409
        : result.code === "send_failed"
          ? 502
          : 500;
  return json(status, {
    ok: false,
    error: result.code,
    message: result.message,
    retryable: result.retryable,
  });
}
