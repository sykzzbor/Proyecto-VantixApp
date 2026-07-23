import { NextResponse } from "next/server";
import { isSameOriginBillingMutation } from "@/server/billing/http";
import { setInternalProfessionalPlanTest } from "@/server/billing/internal-plan-test";
import { getOrgContext, requirePermission } from "@/server/context";
import { ActionError } from "@/server/errors";
import { checkRateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

async function updateInternalPlanTest(request: Request, enabled: boolean) {
  try {
    if (!isSameOriginBillingMutation(request)) {
      return json(
        {
          error: "invalid_origin",
          message: "El origen de la solicitud no es válido.",
        },
        403
      );
    }
    const { user, org, role } = await getOrgContext({
      allowInactiveSubscription: true,
    });
    requirePermission(role, "billing.manage");
    const rate = checkRateLimit(
      `internal-plan-test:${org.id}:${user.id}`,
      4,
      60_000
    );
    if (!rate.allowed) {
      return json(
        {
          error: "rate_limited",
          message: "Esperá un momento antes de volver a intentar.",
        },
        429
      );
    }
    const result = await setInternalProfessionalPlanTest({
      organizationId: org.id,
      userId: user.id,
      userEmail: user.email,
      enabled,
    });
    return json({ ok: true, internalPlanTest: result });
  } catch (error) {
    if (error instanceof ActionError) {
      return json(
        { error: "internal_plan_test_unavailable", message: error.message },
        403
      );
    }
    console.error(
      "[VantixApp] Internal plan test:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return json(
      {
        error: "internal_error",
        message: "No se pudo actualizar el modo interno de prueba.",
      },
      500
    );
  }
}

export async function POST(request: Request) {
  return updateInternalPlanTest(request, true);
}

export async function DELETE(request: Request) {
  return updateInternalPlanTest(request, false);
}
