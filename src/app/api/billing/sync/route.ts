import { NextResponse } from "next/server";
import { getOrgContext, requirePermission } from "@/server/context";
import { ActionError } from "@/server/errors";
import { synchronizeMercadoPagoSubscription } from "@/server/billing/service";
import { BillingProviderError } from "@/server/billing/provider";
import { isSameOriginBillingMutation } from "@/server/billing/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!isSameOriginBillingMutation(request)) {
      return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
    }
    const { org, role } = await getOrgContext({ allowInactiveSubscription: true });
    requirePermission(role, "billing.manage");
    const result = await synchronizeMercadoPagoSubscription({
      organizationId: org.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const known = error instanceof ActionError || error instanceof BillingProviderError;
    return NextResponse.json(
      {
        error: "sync_failed",
        message: known
          ? error instanceof BillingProviderError
            ? error.safeMessage
            : error.message
          : "No se pudo sincronizar la suscripción.",
      },
      { status: known ? 409 : 500 }
    );
  }
}
