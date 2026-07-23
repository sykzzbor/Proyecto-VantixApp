import { prisma } from "@/lib/prisma";
import { ActionError } from "@/server/errors";

export const INTERNAL_PLAN_TEST_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;

function normalizeEmail(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (
    !normalized ||
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function isInternalPlanTestAuthorized(
  userEmail: string,
  configuredEmail = process.env.INTERNAL_PLAN_OVERRIDE_EMAIL
): boolean {
  const user = normalizeEmail(userEmail);
  const configured = normalizeEmail(configuredEmail);
  return Boolean(user && configured && user === configured);
}

export type InternalPlanTestResult = {
  active: boolean;
  plan: "PROFESSIONAL" | null;
  startedAt: string | null;
  endsAt: string | null;
  duplicate: boolean;
};

export async function setInternalProfessionalPlanTest(input: {
  organizationId: string;
  userId: string;
  userEmail: string;
  enabled: boolean;
  now?: Date;
}): Promise<InternalPlanTestResult> {
  if (!isInternalPlanTestAuthorized(input.userEmail)) {
    throw new ActionError(
      "El modo interno de prueba no está habilitado para esta cuenta."
    );
  }

  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const current = await tx.organizationSubscription.findUnique({
      where: { organizationId: input.organizationId },
      select: {
        id: true,
        internalPlanOverride: true,
        internalPlanOverrideStartedAt: true,
        internalPlanOverrideEndsAt: true,
      },
    });
    if (!current) {
      throw new ActionError("La organización todavía no tiene una suscripción.");
    }

    const currentlyActive = Boolean(
      current.internalPlanOverride === "PROFESSIONAL" &&
        current.internalPlanOverrideEndsAt &&
        current.internalPlanOverrideEndsAt > now
    );
    if (input.enabled && currentlyActive) {
      return {
        active: true,
        plan: "PROFESSIONAL",
        startedAt:
          current.internalPlanOverrideStartedAt?.toISOString() ?? null,
        endsAt: current.internalPlanOverrideEndsAt?.toISOString() ?? null,
        duplicate: true,
      };
    }
    if (!input.enabled && !current.internalPlanOverride) {
      return {
        active: false,
        plan: null,
        startedAt: null,
        endsAt: null,
        duplicate: true,
      };
    }

    const endsAt = input.enabled
      ? new Date(now.getTime() + INTERNAL_PLAN_TEST_DURATION_MS)
      : null;
    await tx.organizationSubscription.update({
      where: { organizationId: input.organizationId },
      data: input.enabled
        ? {
            internalPlanOverride: "PROFESSIONAL",
            internalPlanOverrideStartedAt: now,
            internalPlanOverrideEndsAt: endsAt,
            internalPlanOverrideByUserId: input.userId,
          }
        : {
            internalPlanOverride: null,
            internalPlanOverrideStartedAt: null,
            internalPlanOverrideEndsAt: null,
            internalPlanOverrideByUserId: null,
          },
    });
    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        action: input.enabled
          ? "billing.internal_plan_test_enabled"
          : "billing.internal_plan_test_disabled",
        entityType: "subscription",
        entityId: current.id,
        details: input.enabled
          ? { plan: "PROFESSIONAL", endsAt: endsAt?.toISOString() }
          : { restored: true },
      },
    });

    return {
      active: input.enabled,
      plan: input.enabled ? "PROFESSIONAL" : null,
      startedAt: input.enabled ? now.toISOString() : null,
      endsAt: endsAt?.toISOString() ?? null,
      duplicate: false,
    };
  });
}
