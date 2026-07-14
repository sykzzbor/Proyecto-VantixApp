import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getCronSecret } from "@/server/automation/config";
import { processDueAutomationEvents } from "@/server/automation/queue";

export const runtime = "nodejs";
export const maxDuration = 60;

function constantTimeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left, "utf8").digest();
  const b = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * Endpoint interno protegido para procesar eventos pendientes. Pensado para una
 * ejecución programada en Vercel Cron (que envía `Authorization: Bearer …`) o
 * una llamada manual con el header `x-automation-cron-secret`.
 */
async function handle(request: Request) {
  let secret: string;
  try {
    secret = getCronSecret();
  } catch {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const header = request.headers.get("x-automation-cron-secret") ?? "";
  const bearer =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const provided = header || bearer;
  if (!provided || !constantTimeEqual(provided, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await processDueAutomationEvents();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      "[VantixApp] dispatch automatización:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
