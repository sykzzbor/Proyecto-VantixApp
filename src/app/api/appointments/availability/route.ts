import { NextResponse } from "next/server";
import { availabilityRequestSchema } from "@/lib/validations/appointment-settings";
import {
  authorizeAutomationRequest,
  automationJson,
  PRIVATE_NO_STORE_HEADERS,
  readLimitedRawBody,
} from "@/server/automation/http";
import {
  AppointmentAvailabilityError,
  checkAppointmentAvailability,
} from "@/server/appointments/availability";
import { checkRateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;
const AVAILABILITY_RATE_LIMIT = 30;
const AVAILABILITY_RATE_WINDOW_MS = 60_000;

export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(request, "appointments.view");
  if (!authorization.ok) return authorization.response;

  const rate = checkRateLimit(
    `appointments:availability:${authorization.ctx.organizationId}:${authorization.ctx.userId}`,
    AVAILABILITY_RATE_LIMIT,
    AVAILABILITY_RATE_WINDOW_MS
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Hiciste demasiadas consultas. Esperá un momento." },
      {
        status: 429,
        headers: {
          ...PRIVATE_NO_STORE_HEADERS,
          "Retry-After": String(rate.retryAfterSeconds),
        },
      }
    );
  }

  const body = await readLimitedRawBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return automationJson(
      { error: "invalid_body", message: "El cuerpo no es válido." },
      { status: body.reason === "too_large" ? 413 : 400 }
    );
  }
  let unknownBody: unknown;
  try {
    unknownBody = JSON.parse(body.rawBody);
  } catch {
    return automationJson(
      { error: "invalid_body", message: "El cuerpo no es válido." },
      { status: 400 }
    );
  }
  const parsed = availabilityRequestSchema.safeParse(unknownBody);
  if (!parsed.success) {
    return automationJson(
      { error: "invalid_range", message: "Ingresá un rango válido." },
      { status: 422 }
    );
  }

  try {
    const availability = await checkAppointmentAvailability({
      organizationId: authorization.ctx.organizationId,
      request: parsed.data,
    });
    return automationJson({ ok: true, availability });
  } catch (error) {
    if (error instanceof AppointmentAvailabilityError) {
      return automationJson(
        { error: error.code, message: error.safeMessage },
        { status: error.status }
      );
    }
    console.error(
      "[VantixApp] Appointment availability:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      { error: "internal_error", message: "No se pudo consultar la disponibilidad." },
      { status: 500 }
    );
  }
}
