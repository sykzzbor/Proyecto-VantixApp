import { NextResponse } from "next/server";
import { n8nHandoffAlertActionSchema } from "@/lib/validations/automation-webhooks";
import { getN8nCallbackSecret } from "@/server/automation/config";
import { CALLBACK_TIMESTAMP_TOLERANCE_MS } from "@/server/automation/constants";
import {
  executeHandoffAlertAction,
  type HandoffAlertActionResult,
} from "@/server/automation/handoff-alert-action";
import { readLimitedRawBody } from "@/server/automation/http";
import {
  isTimestampFresh,
  verifyTimestampedAutomationSignature,
} from "@/server/automation/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_ACTION_BODY_BYTES = 2 * 1024;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

type HandlerDependencies = {
  getSecret?: () => string;
  execute?: typeof executeHandoffAlertAction;
};

function actionResponse(result: HandoffAlertActionResult) {
  if (result.ok) {
    return json(200, {
      ok: true,
      state: result.state,
      duplicate: result.duplicate,
      callbackRequired: result.callbackRequired,
      ...(result.state === "in_progress"
        ? {}
        : { sentCount: result.sentCount }),
    });
  }

  if (
    result.code === "not_executable" ||
    result.code === "invalid_recipients" ||
    result.code === "template_missing" ||
    result.code === "channel_unavailable"
  ) {
    return json(409, {
      ok: false,
      state: "not_executable",
      error: result.code,
      message: result.message,
      retryable: result.retryable,
    });
  }
  const status =
    result.code === "not_found"
      ? 404
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

export async function handleHandoffAlertRequest(
  request: Request,
  dependencies: HandlerDependencies = {}
) {
  let secret: string;
  try {
    secret = (dependencies.getSecret ?? getN8nCallbackSecret)();
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
  const timestampHeader = request.headers.get("x-vantix-timestamp");
  if (
    !verifyTimestampedAutomationSignature(
      rawBody,
      timestampHeader,
      request.headers.get("x-vantix-signature"),
      secret
    )
  ) {
    return json(401, { error: "invalid_signature" });
  }
  if (!isTimestampFresh(timestampHeader, CALLBACK_TIMESTAMP_TOLERANCE_MS)) {
    return json(401, { error: "stale_timestamp" });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const parsed = n8nHandoffAlertActionSchema.safeParse(body);
  if (!parsed.success) return json(400, { error: "invalid_body" });

  const result = await (dependencies.execute ?? executeHandoffAlertAction)(
    parsed.data
  );
  return actionResponse(result);
}

export async function POST(request: Request) {
  return handleHandoffAlertRequest(request);
}
