import { NextResponse } from "next/server";
import { z } from "zod";
import { billingPlanSchema } from "@/lib/billing/plans";
import { getOrgContext, requirePermission } from "@/server/context";
import { ActionError } from "@/server/errors";
import { createBillingCheckout } from "@/server/billing/service";
import { BillingProviderError } from "@/server/billing/provider";
import { isSameOriginBillingMutation } from "@/server/billing/http";
import { checkRateLimit } from "@/server/rate-limit";
import { readLimitedRawBody } from "@/server/automation/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkoutSchema = z
  .object({
    plan: billingPlanSchema,
    idempotencyKey: z.string().uuid(),
    payerEmail: z.string().trim().toLowerCase().email().max(254),
  })
  .strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  try {
    if (!isSameOriginBillingMutation(request)) {
      return json({ error: "invalid_origin", message: "El origen de la solicitud no es válido." }, 403);
    }
    const { user, org, role } = await getOrgContext({
      allowInactiveSubscription: true,
    });
    requirePermission(role, "billing.manage");
    const rate = checkRateLimit(
      `billing-checkout:${org.id}:${user.id}`,
      5,
      60_000
    );
    if (!rate.allowed) {
      return json({ error: "rate_limited", message: "Esperá un momento antes de volver a intentar." }, 429);
    }
    const rawBody = await readLimitedRawBody(request, 8 * 1024);
    if (!rawBody.ok) {
      return json(
        {
          error: rawBody.reason === "too_large" ? "payload_too_large" : "invalid_request",
          message: "La solicitud no es válida.",
        },
        rawBody.reason === "too_large" ? 413 : 400
      );
    }
    let input: unknown;
    try {
      input = JSON.parse(rawBody.rawBody) as unknown;
    } catch {
      return json({ error: "invalid_request", message: "La solicitud no es válida." }, 400);
    }
    const parsed = checkoutSchema.safeParse(input);
    if (!parsed.success) {
      return json(
        {
          error: "invalid_request",
          message:
            "Ingresá un correo válido de la cuenta de Mercado Pago que realizará el pago.",
        },
        422
      );
    }
    const checkout = await createBillingCheckout(
      {
        organizationId: org.id,
        userId: user.id,
        userEmail: user.email,
      },
      parsed.data
    );
    return json({ ok: true, checkout });
  } catch (error) {
    if (error instanceof ActionError) {
      return json({ error: "billing_unavailable", message: error.message }, 409);
    }
    if (error instanceof BillingProviderError) {
      return json({ error: error.code, message: error.safeMessage }, 502);
    }
    console.error(
      "[VantixApp] Billing checkout:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return json({ error: "internal_error", message: "No se pudo iniciar el pago." }, 500);
  }
}
