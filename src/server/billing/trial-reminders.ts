import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendTransactionalEmail } from "@/server/email/send";
import { trialReminderTemplate } from "@/server/email/templates";

/**
 * Avisos de prueba por vencer: 3 días, 1 día y vencida.
 *
 * La deduplicación se apoya en la clave única de `BillingEvent`: cada aviso
 * tiene una clave determinística por organización y por hito, así que si el
 * job corre dos veces (o se solapan dos ejecuciones) el segundo `create` choca
 * contra el índice y no se manda el correo de nuevo.
 */

export type TrialMilestone = 3 | 1 | 0;

/** Hitos ordenados de más lejano a más cercano. */
const MILESTONES: TrialMilestone[] = [3, 1, 0];

/**
 * Días completos que faltan para que termine la prueba.
 * Se redondea hacia arriba: mientras quede una fracción de día, cuenta.
 */
export function daysUntilTrialEnd(trialEndsAt: Date, now: Date): number {
  const ms = trialEndsAt.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/**
 * Hito que corresponde avisar, o `null` si todavía no toca ninguno.
 *
 * A 2 días no se avisa: el hito de 3 ya salió y el de 1 sale mañana.
 */
export function milestoneFor(trialEndsAt: Date, now: Date): TrialMilestone | null {
  const days = daysUntilTrialEnd(trialEndsAt, now);
  if (days === 0) return 0;
  return MILESTONES.includes(days as TrialMilestone)
    ? (days as TrialMilestone)
    : null;
}

export function trialReminderKey(organizationId: string, milestone: TrialMilestone): string {
  return createHash("sha256")
    .update(`trial-reminder:${organizationId}:${milestone}`, "utf8")
    .digest("hex");
}

export type TrialReminderResult = {
  revisadas: number;
  enviados: number;
  omitidos: number;
  errores: number;
};

/**
 * Recorre las suscripciones en prueba y manda el aviso que corresponda.
 * Pensado para una ejecución programada; es seguro correrlo seguido.
 */
export async function sendDueTrialReminders(
  now: Date = new Date()
): Promise<TrialReminderResult> {
  // Solo prueba vigente o recién vencida: no tiene sentido avisarle a alguien
  // cuya prueba terminó hace semanas.
  const desde = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const hasta = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

  const subscriptions = await prisma.organizationSubscription.findMany({
    where: {
      status: "TRIALING",
      trialEndsAt: { gte: desde, lte: hasta },
    },
    select: {
      id: true,
      organizationId: true,
      trialEndsAt: true,
      status: true,
    },
    take: 500,
  });

  const result: TrialReminderResult = {
    revisadas: subscriptions.length,
    enviados: 0,
    omitidos: 0,
    errores: 0,
  };

  for (const subscription of subscriptions) {
    // Cada organización se procesa aislada: si una falla (correo caído, fila
    // corrupta, dueño sin cuenta), se cuenta el error y el lote sigue. Una
    // organización rota no puede dejar sin aviso a todas las demás.
    try {
      const milestone = milestoneFor(subscription.trialEndsAt, now);
      if (milestone === null) {
        result.omitidos += 1;
        continue;
      }

      const idempotencyKey = trialReminderKey(
        subscription.organizationId,
        milestone
      );

      // Reservar el aviso ANTES de mandarlo: si dos ejecuciones se solapan,
      // solo una gana el índice único y solo esa manda el correo.
      try {
        await prisma.billingEvent.create({
          data: {
            organizationId: subscription.organizationId,
            subscriptionId: subscription.id,
            provider: null,
            idempotencyKey,
            eventType: `trial.reminder.${milestone}`,
            previousStatus: subscription.status,
            nextStatus: subscription.status,
            payloadHash: idempotencyKey,
            status: "PROCESSED",
            occurredAt: now,
            processedAt: now,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          // Ya se avisó este hito: es el caso normal de una segunda corrida.
          result.omitidos += 1;
          continue;
        }
        throw error;
      }

      const owner = await prisma.organizationMember.findFirst({
        where: { organizationId: subscription.organizationId, role: "OWNER" },
        orderBy: { createdAt: "asc" },
        select: { user: { select: { email: true, name: true } } },
      });
      if (!owner?.user.email) {
        result.omitidos += 1;
        continue;
      }

      const sent = await sendTransactionalEmail(
        owner.user.email,
        trialReminderTemplate({
          name: owner.user.name,
          daysLeft: milestone,
          endsAt: subscription.trialEndsAt,
        })
      );

      if (sent.ok) {
        result.enviados += 1;
      } else {
        // El aviso ya quedó reservado, así que no se reintenta solo. Se
        // cuenta como error para que el resumen no diga que salió.
        result.errores += 1;
      }
    } catch (error) {
      result.errores += 1;
      // Sin id de organización ni correo: solo el tipo de falla.
      console.error(
        "[VantixApp][billing] Aviso de prueba omitido por error:",
        error instanceof Error ? error.name : "error desconocido"
      );
    }
  }

  return result;
}
