import { NextResponse, after } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { emitAutomationEvent } from "@/server/automation/events";
import { processDueAutomationEvents } from "@/server/automation/queue";
import { recordAudit } from "@/server/audit";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    mock: z
      .enum(["success", "temporary_error", "permanent_error", "callback"])
      .optional(),
  })
  .optional();

/**
 * Genera un evento `automation.test` para probar toda la infraestructura.
 * Solo OWNER/ADMIN de la organización de la sesión. La organización se resuelve
 * SIEMPRE desde la membresía del usuario, nunca del cuerpo de la petición.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const membership = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "no_organization" }, { status: 403 });
  }
  if (!can(membership.role, "automation.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let rawBody: unknown = {};
  try {
    rawBody = await request.json();
  } catch {
    rawBody = {};
  }
  const parsed = bodySchema.safeParse(rawBody ?? {});
  const mock = parsed.success ? parsed.data?.mock : undefined;

  const result = await emitAutomationEvent({
    organizationId: membership.organizationId,
    type: "automation.test",
    payload: { source: "manual-test", ...(mock ? { mock } : {}) },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 400 });
  }

  await recordAudit({
    organizationId: membership.organizationId,
    userId: session.user.id,
    action: "automation.test_emitted",
    entityType: "automation_event",
    entityId: result.eventId,
    details: { duplicate: result.duplicate },
  });

  // Procesa el evento fuera del render (no bloquea la respuesta).
  after(async () => {
    await processDueAutomationEvents();
  });

  return NextResponse.json({
    ok: true,
    eventId: result.eventId,
    duplicate: result.duplicate,
  });
}
