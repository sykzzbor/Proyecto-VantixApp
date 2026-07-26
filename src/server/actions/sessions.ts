"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/server/context";
import { recordAudit } from "@/server/audit";
import { ActionError, toActionFailure, type ActionResult } from "@/server/errors";
import { summarizeSessions, type SessionSummary } from "@/server/auth/sessions";
import { findActiveMembership } from "@/server/context";

/**
 * Sesiones activas de la persona autenticada.
 *
 * Todas las consultas filtran por `userId` de la sesión: no existe forma de
 * listar ni cerrar la sesión de otra persona, porque el id que llega del
 * navegador siempre se busca junto al `userId` propio.
 */

const idSchema = z.string().min(1).max(64);

export async function listActiveSessions(): Promise<SessionSummary[]> {
  const session = await getSession();
  if (!session) return [];

  const rows = await prisma.session.findMany({
    where: {
      userId: session.user.id,
      // Las vencidas no son "activas": mostrarlas confundiría.
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      token: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      updatedAt: true,
      expiresAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return summarizeSessions(rows, session.session.token);
}

/**
 * La auditoría de sesiones se registra en la organización activa, sin token
 * ni IP: solo el hecho y el dispositivo.
 */
async function auditSession(
  userId: string,
  action: string,
  details: Record<string, unknown>
) {
  const membership = await findActiveMembership(userId);
  if (!membership) return;
  await recordAudit({
    organizationId: membership.organization.id,
    userId,
    action,
    entityType: "session",
    details,
  });
}

export async function revokeSession(sessionId: string): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session) throw new ActionError("Tenés que iniciar sesión para continuar.");
    const id = idSchema.parse(sessionId);

    // El `userId` en el where es lo que impide cerrar la sesión de otra
    // persona: un id ajeno simplemente no encuentra nada.
    const target = await prisma.session.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, token: true, userAgent: true },
    });
    if (!target) throw new ActionError("Esa sesión ya no existe.");

    if (target.token === session.session.token) {
      throw new ActionError(
        "Esta es tu sesión actual. Usá “Cerrar sesión” desde el menú."
      );
    }

    await prisma.session.delete({ where: { id: target.id } });

    await auditSession(session.user.id, "seguridad.sesion_cerrada", {
      dispositivo: target.userAgent ? "identificado" : "desconocido",
    });

    revalidatePath("/dashboard/configuracion");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function revokeOtherSessions(): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session) throw new ActionError("Tenés que iniciar sesión para continuar.");

    const { count } = await prisma.session.deleteMany({
      where: {
        userId: session.user.id,
        NOT: { token: session.session.token },
      },
    });

    await auditSession(session.user.id, "seguridad.sesiones_cerradas", {
      cantidad: count,
    });

    revalidatePath("/dashboard/configuracion");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
