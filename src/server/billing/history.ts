import type { BillingPlanId } from "@/lib/billing/plans";

/**
 * Historial de pagos y movimientos de facturación.
 *
 * Se arma con lo que Mercado Pago efectivamente informó: cada fila sale de un
 * `BillingEvent` (webhook recibido) o de un `PlanPriceSnapshot` (checkout
 * iniciado). Nunca se infiere un cobro que el proveedor no confirmó: si falta
 * un dato se muestra vacío, no se completa con una estimación.
 *
 * La clasificación es pura para poder probarla sin base de datos.
 */

export type PaymentOutcome =
  | "approved"
  | "pending"
  | "rejected"
  | "canceled"
  | "other";

export const PAYMENT_OUTCOME_LABELS: Record<PaymentOutcome, string> = {
  approved: "Aprobado",
  pending: "Pendiente",
  rejected: "Rechazado",
  canceled: "Cancelado",
  other: "Actualización",
};

/**
 * Deriva el resultado visible de un evento a partir del `eventType` que se
 * guardó al procesar el webhook y del estado al que llevó la suscripción.
 *
 * El `eventType` de un pago autorizado tiene la forma
 * `subscription_authorized_payment:<estado>`, donde `<estado>` es el que
 * informa Mercado Pago para ese cobro puntual.
 */
export function classifyBillingEvent(input: {
  eventType: string;
  nextStatus: string | null;
}): PaymentOutcome {
  const type = input.eventType.toLowerCase();

  // Un cobro concreto manda sobre el estado general de la suscripción.
  if (type.includes("authorized_payment")) {
    if (type.includes("rejected")) return "rejected";
    if (type.includes("pending") || type.includes("in_process")) return "pending";
    if (type.includes("approved") || type.includes("accredited")) return "approved";
  }

  if (type.includes("rejected")) return "rejected";
  if (type.includes("pending")) return "pending";
  if (type.includes("cancel")) return "canceled";

  switch (input.nextStatus) {
    case "ACTIVE":
      return "approved";
    case "PAST_DUE":
      return "rejected";
    case "CANCELED":
      return "canceled";
    case "INCOMPLETE":
      return "pending";
    default:
      return "other";
  }
}

/** Texto corto para la fila del historial. */
export function describeBillingEvent(input: {
  eventType: string;
  outcome: PaymentOutcome;
}): string {
  const type = input.eventType.toLowerCase();
  if (type.includes("authorized_payment")) {
    switch (input.outcome) {
      case "approved":
        return "Cobro de la suscripción";
      case "pending":
        return "Cobro en revisión";
      case "rejected":
        return "Cobro rechazado";
      default:
        return "Movimiento de cobro";
    }
  }
  if (type.includes("trial.started")) return "Inicio de la prueba gratuita";
  if (type.includes("cancel")) return "Cancelación de la suscripción";
  if (type.includes("preapproval")) return "Actualización de la suscripción";
  return "Movimiento de facturación";
}

export type BillingHistoryEntry = {
  id: string;
  /** ISO. Momento informado por el proveedor; si falta, cuándo se registró. */
  occurredAt: string;
  outcome: PaymentOutcome;
  outcomeLabel: string;
  description: string;
  /** Importe cobrado en ARS. `null` cuando el proveedor no informó monto. */
  amountArs: number | null;
  currency: "ARS" | null;
  plan: BillingPlanId | null;
  /** `true` si el evento se descartó por duplicado o por no corresponder. */
  ignored: boolean;
};

type RawEvent = {
  id: string;
  eventType: string;
  nextStatus: string | null;
  status: string;
  occurredAt: Date | null;
  createdAt: Date;
};

type RawSnapshot = {
  plan: BillingPlanId;
  arsAmount: number;
  providerAmountArs: number | null;
  externalSubscriptionId: string | null;
  createdAt: Date;
};

/**
 * Combina eventos con los importes del checkout que los originó.
 *
 * El importe no vive en el evento: está en el snapshot de precio que se creó
 * al iniciar el checkout. Se toma el snapshot vigente más cercano anterior al
 * evento; si no hay ninguno, el importe queda en `null` en vez de inventarse.
 */
export function buildBillingHistory(input: {
  events: RawEvent[];
  snapshots: RawSnapshot[];
}): BillingHistoryEntry[] {
  const ordenados = [...input.snapshots].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  return input.events
    .map((event) => {
      const momento = event.occurredAt ?? event.createdAt;
      const outcome = classifyBillingEvent({
        eventType: event.eventType,
        nextStatus: event.nextStatus,
      });

      // Snapshot vigente al momento del evento.
      const snapshot = [...ordenados]
        .reverse()
        .find((s) => s.createdAt.getTime() <= momento.getTime() + 60_000);

      // Solo los movimientos de cobro llevan importe; una cancelación o el
      // inicio de la prueba no cobran nada.
      const esCobro = event.eventType.toLowerCase().includes("authorized_payment");
      const amountArs =
        esCobro && snapshot
          ? snapshot.providerAmountArs ?? snapshot.arsAmount
          : null;

      return {
        id: event.id,
        occurredAt: momento.toISOString(),
        outcome,
        outcomeLabel: PAYMENT_OUTCOME_LABELS[outcome],
        description: describeBillingEvent({ eventType: event.eventType, outcome }),
        amountArs,
        currency: amountArs === null ? null : ("ARS" as const),
        plan: snapshot?.plan ?? null,
        ignored: event.status === "IGNORED" || event.status === "FAILED",
      } satisfies BillingHistoryEntry;
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
