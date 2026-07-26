import { prisma } from "@/lib/prisma";
import { BILLING_PLANS, type BillingPlanId } from "@/lib/billing/plans";
import { sendTransactionalEmail } from "@/server/email/send";
import {
  paymentApprovedTemplate,
  paymentRejectedTemplate,
  subscriptionCanceledTemplate,
} from "@/server/email/templates";
import { classifyBillingEvent } from "@/server/billing/history";

/**
 * Avisos por correo de los movimientos de facturación.
 *
 * Se llaman solo cuando el webhook aplicó cambios de verdad: si Mercado Pago
 * reintenta la misma notificación, `applyMercadoPagoSubscriptionUpdate` corta
 * antes por la clave de idempotencia y nunca llega acá, así que un reintento
 * no vuelve a mandar el correo.
 *
 * Un fallo de correo nunca puede tumbar el procesamiento del pago: se registra
 * y se sigue.
 */

/** Destinatario: la persona propietaria de la organización. */
async function findOwnerRecipient(organizationId: string) {
  const owner = await prisma.organizationMember.findFirst({
    where: { organizationId, role: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { email: true, name: true } } },
  });
  return owner?.user ?? null;
}

export async function notifyBillingOutcome(input: {
  organizationId: string;
  plan: BillingPlanId;
  eventType: string;
  nextStatus: string;
  amountArs: number | null;
  nextBillingAt: Date | null;
  currentPeriodEndsAt: Date | null;
}): Promise<void> {
  try {
    const outcome = classifyBillingEvent({
      eventType: input.eventType,
      nextStatus: input.nextStatus,
    });

    // Pendiente y "otros" no generan aviso: un cobro en revisión se resuelve
    // solo en minutos y avisar por cada paso intermedio es ruido.
    if (outcome !== "approved" && outcome !== "rejected" && outcome !== "canceled") {
      return;
    }

    const recipient = await findOwnerRecipient(input.organizationId);
    if (!recipient?.email) return;

    const planName = BILLING_PLANS[input.plan].name;

    const message =
      outcome === "approved"
        ? paymentApprovedTemplate({
            name: recipient.name,
            planName,
            amountArs: input.amountArs,
            nextBillingAt: input.nextBillingAt,
          })
        : outcome === "rejected"
          ? paymentRejectedTemplate({ name: recipient.name, planName })
          : subscriptionCanceledTemplate({
              name: recipient.name,
              planName,
              accessUntil: input.currentPeriodEndsAt,
            });

    await sendTransactionalEmail(recipient.email, message);
  } catch (error) {
    console.error(
      "[VantixApp][billing] No se pudo enviar el aviso de facturación:",
      error instanceof Error ? error.name : "error desconocido"
    );
  }
}
