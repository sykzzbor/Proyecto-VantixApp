import { NextResponse } from "next/server";
import { authorizeBillingCron } from "@/server/billing/cron-auth";
import { sendDueTrialReminders } from "@/server/billing/trial-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Avisos de prueba por vencer (3 días, 1 día y vencida).
 *
 * Lo dispara Vercel Cron una vez por día con `Authorization: Bearer
 * $CRON_SECRET`. Es idempotente: correrlo varias veces el mismo día no manda
 * correos repetidos, porque cada aviso reserva su lugar contra la clave única
 * de `BillingEvent` antes de enviarse.
 */
async function handle(request: Request) {
  const auth = authorizeBillingCron(request.headers);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const result = await sendDueTrialReminders();

    // Solo contadores: ni correos, ni ids de organización, ni nada que
    // identifique a un cliente en los logs de la plataforma.
    console.info(
      `[VantixApp][billing] Avisos de prueba — revisadas: ${result.revisadas}, ` +
        `enviados: ${result.enviados}, omitidos: ${result.omitidos}, errores: ${result.errores}`
    );

    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(
      "[VantixApp][billing] Avisos de prueba:",
      error instanceof Error ? error.name : "error desconocido"
    );
    return NextResponse.json({ error: "reminder_failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
