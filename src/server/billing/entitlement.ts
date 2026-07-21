import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import {
  BILLING_PLANS,
  type BillingPlanId,
} from "@/lib/billing/plans";
import { ActionError } from "@/server/errors";

export const TRIAL_DURATION_MS = 5 * 24 * 60 * 60 * 1_000;

export const SUBSCRIPTION_STATUSES = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "EXPIRED",
  "INCOMPLETE",
] as const;

export type SubscriptionStatusValue = (typeof SUBSCRIPTION_STATUSES)[number];

export type SubscriptionForEntitlement = {
  id: string;
  organizationId: string;
  plan: BillingPlanId;
  status: SubscriptionStatusValue;
  trialStartedAt: Date;
  trialEndsAt: Date;
  subscriptionStartedAt: Date | null;
  currentPeriodEndsAt: Date | null;
  nextBillingAt: Date | null;
  canceledAt: Date | null;
  endedAt: Date | null;
};

export type OrganizationEntitlement = {
  plan: BillingPlanId;
  planName: string;
  status: SubscriptionStatusValue;
  accessAllowed: boolean;
  reason:
    | "TRIAL_ACTIVE"
    | "SUBSCRIPTION_ACTIVE"
    | "CANCELED_PERIOD_ACTIVE"
    | "TRIAL_EXPIRED"
    | "PAST_DUE"
    | "CANCELED_PERIOD_ENDED"
    | "INCOMPLETE"
    | "MISSING_SUBSCRIPTION";
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  nextBillingAt: string | null;
  remainingMs: number;
  remainingDays: number;
  remainingHours: number;
};

export class SubscriptionRequiredError extends ActionError {
  readonly code = "subscription_required";

  constructor() {
    super(
      "Tu prueba o período contratado terminó. Elegí un plan para continuar usando esta función."
    );
    this.name = "SubscriptionRequiredError";
  }
}

function remaining(until: Date | null, now: Date) {
  const milliseconds = until ? Math.max(0, until.getTime() - now.getTime()) : 0;
  return {
    remainingMs: milliseconds,
    remainingDays: Math.ceil(milliseconds / (24 * 60 * 60 * 1_000)),
    remainingHours: Math.ceil(milliseconds / (60 * 60 * 1_000)),
  };
}

export function evaluateOrganizationEntitlement(
  _organizationId: string,
  subscription: SubscriptionForEntitlement | null,
  now = new Date()
): OrganizationEntitlement {
  if (!subscription) {
    return {
      plan: "STANDARD",
      planName: BILLING_PLANS.STANDARD.name,
      status: "INCOMPLETE",
      accessAllowed: false,
      reason: "MISSING_SUBSCRIPTION",
      trialStartedAt: null,
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      nextBillingAt: null,
      remainingMs: 0,
      remainingDays: 0,
      remainingHours: 0,
    };
  }

  const base = {
    plan: subscription.plan,
    planName: BILLING_PLANS[subscription.plan].name,
    trialStartedAt: subscription.trialStartedAt.toISOString(),
    trialEndsAt: subscription.trialEndsAt.toISOString(),
    currentPeriodEndsAt: subscription.currentPeriodEndsAt?.toISOString() ?? null,
    nextBillingAt: subscription.nextBillingAt?.toISOString() ?? null,
  };

  if (subscription.status === "TRIALING") {
    const trial = remaining(subscription.trialEndsAt, now);
    const accessAllowed = trial.remainingMs > 0;
    return {
      ...base,
      status: accessAllowed ? "TRIALING" : "EXPIRED",
      accessAllowed,
      reason: accessAllowed ? "TRIAL_ACTIVE" : "TRIAL_EXPIRED",
      ...trial,
    };
  }

  if (subscription.status === "ACTIVE") {
    return {
      ...base,
      status: "ACTIVE",
      accessAllowed: true,
      reason: "SUBSCRIPTION_ACTIVE",
      ...remaining(subscription.currentPeriodEndsAt, now),
    };
  }

  if (subscription.status === "CANCELED") {
    const paidUntil = subscription.currentPeriodEndsAt ?? subscription.endedAt;
    const paid = remaining(paidUntil, now);
    const accessAllowed = paid.remainingMs > 0;
    return {
      ...base,
      status: "CANCELED",
      accessAllowed,
      reason: accessAllowed
        ? "CANCELED_PERIOD_ACTIVE"
        : "CANCELED_PERIOD_ENDED",
      ...paid,
    };
  }

  const reason =
    subscription.status === "PAST_DUE"
      ? "PAST_DUE"
      : subscription.status === "INCOMPLETE"
        ? "INCOMPLETE"
        : "TRIAL_EXPIRED";
  return {
    ...base,
    status: subscription.status,
    accessAllowed: false,
    reason,
    ...remaining(null, now),
  };
}

export async function getOrganizationEntitlement(
  organizationId: string,
  now = new Date()
): Promise<OrganizationEntitlement> {
  const select = {
    id: true,
    organizationId: true,
    plan: true,
    status: true,
    trialStartedAt: true,
    trialEndsAt: true,
    subscriptionStartedAt: true,
    currentPeriodEndsAt: true,
    nextBillingAt: true,
    canceledAt: true,
    endedAt: true,
  } as const;
  const subscription = await prisma.$transaction(async (tx) => {
    const current = await tx.organizationSubscription.findUnique({
      where: { organizationId },
      select,
    });
    if (
      !current ||
      current.status !== "TRIALING" ||
      current.trialEndsAt > now
    ) {
      return current;
    }
    const expired = await tx.organizationSubscription.updateMany({
      where: {
        id: current.id,
        organizationId,
        status: "TRIALING",
        trialEndsAt: { lte: now },
      },
      data: { status: "EXPIRED", endedAt: now },
    });
    if (expired.count === 1) {
      await tx.billingEvent.create({
        data: {
          organizationId,
          subscriptionId: current.id,
          provider: null,
          idempotencyKey: `trial-expired:${current.id}`,
          eventType: "trial.expired",
          previousStatus: "TRIALING",
          nextStatus: "EXPIRED",
          payloadHash: createHash("sha256")
            .update(`trial.expired:${current.id}`, "utf8")
            .digest("hex"),
          status: "PROCESSED",
          occurredAt: now,
          processedAt: now,
        },
      });
      return { ...current, status: "EXPIRED" as const, endedAt: now };
    }
    return tx.organizationSubscription.findUnique({
      where: { organizationId },
      select,
    });
  });

  const entitlement = evaluateOrganizationEntitlement(
    organizationId,
    subscription as SubscriptionForEntitlement | null,
    now
  );
  if (!entitlement.accessAllowed) {
    const cancelled = await prisma.automationEvent.updateMany({
      where: { organizationId, status: "PENDING" },
      data: {
        status: "CANCELLED",
        cancellationReason: "organization_disabled",
        nextAttemptAt: null,
        lockedAt: null,
        processedAt: now,
      },
    });
    if (cancelled.count > 0) {
      await prisma.auditLog.create({
        data: {
          organizationId,
          userId: null,
          action: "billing.automations_cancelled",
          entityType: "subscription",
          entityId: subscription?.id ?? null,
          details: { reason: "subscription_inactive", count: cancelled.count },
        },
      });
    }
  }
  return entitlement;
}

export async function requireActiveSubscription(
  organizationId: string,
  now = new Date()
): Promise<OrganizationEntitlement> {
  const entitlement = await getOrganizationEntitlement(organizationId, now);
  return assertActiveOrganizationEntitlement(entitlement);
}

export function assertActiveOrganizationEntitlement(
  entitlement: OrganizationEntitlement
): OrganizationEntitlement {
  if (!entitlement.accessAllowed) throw new SubscriptionRequiredError();
  return entitlement;
}
