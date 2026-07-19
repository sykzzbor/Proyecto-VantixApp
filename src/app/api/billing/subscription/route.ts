import { NextResponse } from "next/server";
import { getOrgContext } from "@/server/context";
import { ActionError } from "@/server/errors";
import { getBillingOverview } from "@/server/billing/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { org } = await getOrgContext({ allowInactiveSubscription: true });
    return NextResponse.json(await getBillingOverview(org.id), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    const message =
      error instanceof ActionError
        ? error.message
        : "No se pudo cargar la suscripción.";
    return NextResponse.json(
      { error: "subscription_unavailable", message },
      {
        status: error instanceof ActionError ? 403 : 500,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      }
    );
  }
}
