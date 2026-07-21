import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  BILLING_PLANS,
  type BillingPlanId,
} from "@/lib/billing/plans";
import { convertUsdToArs } from "@/lib/plans-pricing";
import { ActionError } from "@/server/errors";
import { recordAudit } from "@/server/audit";
import { getPlansExchangeRate } from "@/server/plans/exchange-rate";
import {
  getOrganizationEntitlement,
  type OrganizationEntitlement,
  type SubscriptionStatusValue,
} from "@/server/billing/entitlement";
import {
  BillingProviderError,
  type BillingProvider,
  type BillingProviderSubscription,
} from "@/server/billing/provider";
import {
  MercadoPagoBillingProvider,
  getMercadoPagoConfiguration,
} from "@/server/billing/mercado-pago";
import {
  buildBillingWebhookIdempotencyKey,
  resolveMercadoPagoStatus,
  sanitizeBillingErrorCode,
} from "@/server/billing/state";

export type BillingOverview = {
  entitlement: OrganizationEntitlement;
  billingConfigured: boolean;
  checkoutUnavailableReason: string | null;
  pendingPlan: BillingPlanId | null;
  canSynchronize: boolean;
  canCancel: boolean;
  lastSyncedAt: string | null;
};

export type BillingCheckoutResult = {
  checkoutUrl: string;
  amountArs: number;
  exchangeRate: number;
  exchangeSource: string;
  quotedAt: string;
  duplicate: boolean;
};

type CheckoutContext = {
  organizationId: string;
  userId: string;
  userEmail: string;
};

export function isRemoteSubscriptionForSnapshot(
  remote: BillingProviderSubscription,
  snapshotId: string
): boolean {
  return remote.externalReference === `vantix:${snapshotId}`;
}

export function selectExternalSubscriptionToSynchronize(input: {
  pendingExternalSubscriptionId: string | null;
  activeExternalSubscriptionId: string | null;
}): string | null {
  return (
    input.pendingExternalSubscriptionId ?? input.activeExternalSubscriptionId
  );
}

export async function getBillingOverview(
  organizationId: string
): Promise<BillingOverview> {
  const [entitlement, pending, subscription, configuration] = await Promise.all([
    getOrganizationEntitlement(organizationId),
    prisma.planPriceSnapshot.findFirst({
      where: { organizationId, checkoutStatus: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { plan: true, externalSubscriptionId: true },
    }),
    prisma.organizationSubscription.findUnique({
      where: { organizationId },
      select: {
        status: true,
        externalSubscriptionId: true,
        lastSyncedAt: true,
      },
    }),
    Promise.resolve(getMercadoPagoConfiguration()),
  ]);
  return {
    entitlement,
    billingConfigured: configuration.configured,
    checkoutUnavailableReason: configuration.configured
      ? null
      : "Los pagos todavía no están habilitados. Podés comparar los planes y volver a intentarlo más tarde.",
    pendingPlan: (pending?.plan as BillingPlanId | undefined) ?? null,
    canSynchronize: Boolean(
      configuration.configured &&
        (subscription?.externalSubscriptionId || pending?.externalSubscriptionId)
    ),
    canCancel: Boolean(
      configuration.configured &&
        subscription?.externalSubscriptionId &&
        subscription.status !== "CANCELED"
    ),
    lastSyncedAt: subscription?.lastSyncedAt?.toISOString() ?? null,
  };
}

function ensureExistingCheckoutBelongsToOrganization(
  existing: {
    organizationId: string;
    checkoutStatus: string;
    checkoutUrl: string | null;
    arsAmount: Prisma.Decimal;
    exchangeRate: Prisma.Decimal;
    exchangeSource: string;
    quotedAt: Date;
  },
  organizationId: string
): BillingCheckoutResult {
  if (existing.organizationId !== organizationId) {
    throw new ActionError("La solicitud de pago no es válida.");
  }
  if (existing.checkoutStatus !== "PENDING" || !existing.checkoutUrl) {
    throw new ActionError(
      "Esta solicitud ya fue procesada. Actualizá la página antes de reintentar."
    );
  }
  return {
    checkoutUrl: existing.checkoutUrl,
    amountArs: existing.arsAmount.toNumber(),
    exchangeRate: existing.exchangeRate.toNumber(),
    exchangeSource: existing.exchangeSource,
    quotedAt: existing.quotedAt.toISOString(),
    duplicate: true,
  };
}

export async function createBillingCheckout(
  context: CheckoutContext,
  input: { plan: BillingPlanId; idempotencyKey: string },
  dependencies?: {
    provider?: BillingProvider;
    now?: Date;
  }
): Promise<BillingCheckoutResult> {
  const now = dependencies?.now ?? new Date();
  const configuration = getMercadoPagoConfiguration();
  if (!configuration.configured || !configuration.appUrl) {
    throw new ActionError("Los pagos todavía no están configurados.");
  }

  const existing = await prisma.planPriceSnapshot.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: {
      organizationId: true,
      checkoutStatus: true,
      checkoutUrl: true,
      arsAmount: true,
      exchangeRate: true,
      exchangeSource: true,
      quotedAt: true,
    },
  });
  if (existing) {
    return ensureExistingCheckoutBelongsToOrganization(
      existing,
      context.organizationId
    );
  }

  const [subscription, exchange] = await Promise.all([
    prisma.organizationSubscription.findUnique({
      where: { organizationId: context.organizationId },
      select: { id: true },
    }),
    getPlansExchangeRate({ now: now.getTime() }),
  ]);
  if (!subscription) {
    throw new ActionError("No encontramos la suscripción de esta organización.");
  }
  if (!exchange.rate || !exchange.source || !exchange.updatedAt) {
    throw new ActionError(
      "No hay una cotización válida disponible para iniciar el pago en ARS."
    );
  }

  const plan = BILLING_PLANS[input.plan];
  const amountArs = convertUsdToArs(plan.usdMonthly, exchange.rate);
  if (amountArs <= 0) {
    throw new ActionError("No se pudo calcular un importe de pago válido.");
  }

  let snapshot;
  try {
    snapshot = await prisma.planPriceSnapshot.create({
      data: {
        organizationId: context.organizationId,
        subscriptionId: subscription.id,
        createdByUserId: context.userId,
        plan: input.plan,
        usdAmount: plan.usdMonthly,
        arsAmount: amountArs,
        exchangeRate: exchange.rate,
        exchangeSource: exchange.source,
        quotedAt: new Date(exchange.updatedAt),
        idempotencyKey: input.idempotencyKey,
        checkoutStatus: "QUOTED",
      },
      select: { id: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.planPriceSnapshot.findUniqueOrThrow({
        where: { idempotencyKey: input.idempotencyKey },
        select: {
          organizationId: true,
          checkoutStatus: true,
          checkoutUrl: true,
          arsAmount: true,
          exchangeRate: true,
          exchangeSource: true,
          quotedAt: true,
        },
      });
      return ensureExistingCheckoutBelongsToOrganization(
        raced,
        context.organizationId
      );
    }
    throw error;
  }

  const provider = dependencies?.provider ?? new MercadoPagoBillingProvider();
  try {
    const created = await provider.createSubscription({
      plan: input.plan,
      payerEmail: context.userEmail,
      externalReference: `vantix:${snapshot.id}`,
      amountArs,
      returnUrl: `${configuration.appUrl}/api/billing/return`,
    });
    const updated = await prisma.planPriceSnapshot.update({
      where: { id: snapshot.id },
      data: {
        checkoutStatus: "PENDING",
        externalSubscriptionId: created.id,
        checkoutUrl: created.checkoutUrl,
      },
      select: {
        checkoutUrl: true,
        arsAmount: true,
        exchangeRate: true,
        exchangeSource: true,
        quotedAt: true,
      },
    });
    await recordAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "billing.checkout_started",
      entityType: "subscription",
      entityId: subscription.id,
      details: { plan: input.plan, currency: "ARS", amount: amountArs },
    });
    return {
      checkoutUrl: updated.checkoutUrl!,
      amountArs: updated.arsAmount.toNumber(),
      exchangeRate: updated.exchangeRate.toNumber(),
      exchangeSource: updated.exchangeSource,
      quotedAt: updated.quotedAt.toISOString(),
      duplicate: false,
    };
  } catch (error) {
    await prisma.planPriceSnapshot.updateMany({
      where: { id: snapshot.id, checkoutStatus: "QUOTED" },
      data: { checkoutStatus: "FAILED" },
    });
    await prisma.organizationSubscription.updateMany({
      where: { id: subscription.id, organizationId: context.organizationId },
      data: { lastError: sanitizeBillingErrorCode(error) },
    });
    if (error instanceof BillingProviderError) {
      throw new ActionError(error.safeMessage);
    }
    throw error;
  }
}

function periodEndForRemote(
  remote: BillingProviderSubscription,
  nextStatus: SubscriptionStatusValue,
  currentPeriodEndsAt: Date | null
) {
  if (nextStatus === "ACTIVE") return remote.nextPaymentAt;
  if (nextStatus === "CANCELED") {
    return remote.nextPaymentAt ?? currentPeriodEndsAt;
  }
  return currentPeriodEndsAt;
}

export async function applyMercadoPagoSubscriptionUpdate(input: {
  remote: BillingProviderSubscription;
  eventType: string;
  payloadHash: string;
  occurredAt?: Date | null;
  now?: Date;
  provider?: BillingProvider;
  chargedAmountArs?: number;
  chargedCurrency?: string;
  externalEventId?: string;
}): Promise<{ duplicate: boolean; status: SubscriptionStatusValue }> {
  const now = input.now ?? new Date();
  const snapshot = await prisma.planPriceSnapshot.findUnique({
    where: { externalSubscriptionId: input.remote.id },
    select: {
      id: true,
      organizationId: true,
      subscriptionId: true,
      plan: true,
      arsAmount: true,
      checkoutStatus: true,
      subscription: {
        select: {
          status: true,
          trialEndsAt: true,
          currentPeriodEndsAt: true,
          externalSubscriptionId: true,
        },
      },
    },
  });
  if (!snapshot || !isRemoteSubscriptionForSnapshot(input.remote, snapshot.id)) {
    throw new ActionError("La notificación de pago no corresponde a una suscripción válida.");
  }
  if (
    input.remote.status === "authorized" &&
    (input.remote.currency !== "ARS" ||
      input.remote.amountArs === null ||
      Math.abs(input.remote.amountArs - snapshot.arsAmount.toNumber()) > 0.01)
  ) {
    throw new ActionError(
      "El importe confirmado no coincide con el checkout iniciado."
    );
  }
  if (
    input.chargedAmountArs !== undefined &&
    (input.chargedCurrency !== "ARS" ||
      Math.abs(input.chargedAmountArs - snapshot.arsAmount.toNumber()) > 0.01)
  ) {
    throw new ActionError(
      "El pago informado no coincide con el importe autorizado."
    );
  }

  const nextStatus = resolveMercadoPagoStatus({
    remote: input.remote,
    currentStatus: snapshot.subscription.status as SubscriptionStatusValue,
    trialEndsAt: snapshot.subscription.trialEndsAt,
    now,
    eventType: input.eventType,
  });
  const idempotencyKey = buildBillingWebhookIdempotencyKey({
    provider: "MERCADO_PAGO",
    eventType: input.eventType,
    remote: input.remote,
    externalEventId: input.externalEventId,
  });

  const staleSubscription =
    snapshot.subscription.externalSubscriptionId &&
    snapshot.subscription.externalSubscriptionId !== input.remote.id &&
    snapshot.checkoutStatus !== "PENDING";
  if (staleSubscription) {
    try {
      await prisma.billingEvent.create({
        data: {
          organizationId: snapshot.organizationId,
          subscriptionId: snapshot.subscriptionId,
          provider: "MERCADO_PAGO",
          idempotencyKey,
          externalEventId: input.externalEventId ?? input.remote.id,
          eventType: input.eventType.slice(0, 120),
          previousStatus: snapshot.subscription.status,
          nextStatus: snapshot.subscription.status,
          payloadHash: input.payloadHash,
          status: "IGNORED",
          occurredAt: input.occurredAt ?? input.remote.lastModifiedAt,
          processedAt: now,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return {
          duplicate: true,
          status: snapshot.subscription.status as SubscriptionStatusValue,
        };
      }
      throw error;
    }
    return {
      duplicate: false,
      status: snapshot.subscription.status as SubscriptionStatusValue,
    };
  }

  const previousExternalSubscriptionId =
    snapshot.subscription.externalSubscriptionId;

  try {
    await prisma.$transaction(async (tx) => {
      const event = await tx.billingEvent.create({
        data: {
          organizationId: snapshot.organizationId,
          subscriptionId: snapshot.subscriptionId,
          provider: "MERCADO_PAGO",
          idempotencyKey,
          externalEventId: input.externalEventId ?? input.remote.id,
          eventType: input.eventType.slice(0, 120),
          previousStatus: snapshot.subscription.status,
          nextStatus,
          payloadHash: input.payloadHash,
          status: "RECEIVED",
          occurredAt: input.occurredAt ?? input.remote.lastModifiedAt,
        },
        select: { id: true },
      });

      const currentPeriodEndsAt = periodEndForRemote(
        input.remote,
        nextStatus,
        snapshot.subscription.currentPeriodEndsAt
      );
      await tx.organizationSubscription.update({
        where: { id: snapshot.subscriptionId },
        data: {
          ...(nextStatus === "ACTIVE" ? { plan: snapshot.plan } : {}),
          status: nextStatus,
          provider: "MERCADO_PAGO",
          externalSubscriptionId: input.remote.id,
          externalCustomerId: input.remote.payerId,
          subscriptionStartedAt:
            nextStatus === "ACTIVE"
              ? input.remote.startedAt ?? now
              : undefined,
          currentPeriodEndsAt,
          nextBillingAt: input.remote.nextPaymentAt,
          canceledAt: nextStatus === "CANCELED" ? now : null,
          endedAt:
            nextStatus === "CANCELED" &&
            (!currentPeriodEndsAt || currentPeriodEndsAt <= now)
              ? now
              : null,
          lastSyncedAt: now,
          lastError: nextStatus === "PAST_DUE" ? "payment_rejected" : null,
        },
      });
      await tx.planPriceSnapshot.update({
        where: { id: snapshot.id },
        data: {
          checkoutStatus:
            nextStatus === "ACTIVE"
              ? "CONFIRMED"
              : nextStatus === "PAST_DUE"
                ? "FAILED"
                : nextStatus === "CANCELED"
                  ? "EXPIRED"
                  : "PENDING",
        },
      });
      await tx.billingEvent.update({
        where: { id: event.id },
        data: { status: "PROCESSED", processedAt: now },
      });
      await tx.auditLog.create({
        data: {
          organizationId: snapshot.organizationId,
          userId: null,
          action: "billing.subscription_updated",
          entityType: "subscription",
          entityId: snapshot.subscriptionId,
          details: { status: nextStatus, plan: snapshot.plan },
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { duplicate: true, status: nextStatus };
    }
    throw error;
  }

  if (
    nextStatus === "ACTIVE" &&
    previousExternalSubscriptionId &&
    previousExternalSubscriptionId !== input.remote.id &&
    input.provider
  ) {
    try {
      await input.provider.cancelSubscription(previousExternalSubscriptionId);
    } catch (error) {
      await prisma.organizationSubscription.updateMany({
        where: {
          id: snapshot.subscriptionId,
          organizationId: snapshot.organizationId,
          externalSubscriptionId: input.remote.id,
        },
        data: { lastError: "previous_subscription_cancel_failed" },
      });
      console.error(
        "[VantixApp] Billing plan switch cleanup:",
        error instanceof Error ? error.name : "unknown_error"
      );
    }
  }
  return { duplicate: false, status: nextStatus };
}

export async function synchronizeMercadoPagoSubscription(input: {
  organizationId: string;
  eventType?: string;
  provider?: BillingProvider;
}) {
  const [subscription, pending] = await Promise.all([
    prisma.organizationSubscription.findUnique({
      where: { organizationId: input.organizationId },
      select: { externalSubscriptionId: true },
    }),
    prisma.planPriceSnapshot.findFirst({
      where: {
        organizationId: input.organizationId,
        checkoutStatus: "PENDING",
        externalSubscriptionId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { externalSubscriptionId: true },
    }),
  ]);
  // En un cambio de plan se sincroniza primero el checkout nuevo; consultar
  // siempre la suscripción activa anterior impediría confirmar el cambio.
  const externalSubscriptionId = selectExternalSubscriptionToSynchronize({
    pendingExternalSubscriptionId: pending?.externalSubscriptionId ?? null,
    activeExternalSubscriptionId:
      subscription?.externalSubscriptionId ?? null,
  });
  if (!externalSubscriptionId) {
    throw new ActionError("No hay una suscripción de Mercado Pago para sincronizar.");
  }
  const provider = input.provider ?? new MercadoPagoBillingProvider();
  const remote = await provider.getSubscription(externalSubscriptionId);
  return applyMercadoPagoSubscriptionUpdate({
    remote,
    eventType: input.eventType ?? "manual.sync",
    payloadHash: createHash("sha256").update("manual.sync").digest("hex"),
  });
}

export async function cancelMercadoPagoSubscription(input: {
  organizationId: string;
  provider?: BillingProvider;
}) {
  const subscription = await prisma.organizationSubscription.findUnique({
    where: { organizationId: input.organizationId },
    select: { externalSubscriptionId: true, status: true },
  });
  if (!subscription?.externalSubscriptionId) {
    throw new ActionError("No hay una suscripción activa para cancelar.");
  }
  if (subscription.status === "CANCELED") {
    return { duplicate: true, status: "CANCELED" as const };
  }
  const provider = input.provider ?? new MercadoPagoBillingProvider();
  const remote = await provider.cancelSubscription(subscription.externalSubscriptionId);
  return applyMercadoPagoSubscriptionUpdate({
    remote,
    eventType: "manual.cancel",
    payloadHash: createHash("sha256").update("manual.cancel").digest("hex"),
  });
}
