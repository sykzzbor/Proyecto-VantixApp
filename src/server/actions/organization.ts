"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  createOrganizationSchema,
  renameOrganizationSchema,
  type CreateOrganizationInput,
  type RenameOrganizationInput,
} from "@/lib/validations/business";
import { recordAudit } from "@/server/audit";
import {
  getOrgContext,
  getSessionUser,
  requirePermission,
} from "@/server/context";
import { toActionFailure, type ActionResult } from "@/server/errors";
import {
  createInitialOrganization,
  ONBOARDING_NEXT_PATH,
  toPublicOnboardingError,
  type InitialOrganizationDependencies,
} from "@/server/organizations/onboarding";

export type CreateOrganizationFormState = {
  status: "idle" | "error";
  error: string | null;
  fieldError: string | null;
  submittedName: string;
  attempt: number;
};

const initialOrganizationDependencies: InitialOrganizationDependencies = {
  async runExclusive(userId, operation) {
    return prisma.$transaction(async (tx) => {
      // Una exclusión transaccional por usuario evita que dos requests creen
      // organizaciones distintas antes de que exista la primera membresía.
      // La función de PostgreSQL devuelve `void`; proyectar un booleano evita
      // que el adapter de Prisma intente deserializar ese tipo nativo.
      await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(hashtextextended(${`vantix-onboarding:${userId}`}, 0))`;

      return operation({
        async userExists(candidateUserId) {
          return (
            (await tx.user.findUnique({
              where: { id: candidateUserId },
              select: { id: true },
            })) !== null
          );
        },
        async findMembership(candidateUserId) {
          const membership = await tx.organizationMember.findFirst({
            where: { userId: candidateUserId },
            orderBy: { createdAt: "asc" },
            select: {
              organization: { select: { id: true, name: true } },
            },
          });
          return membership?.organization ?? null;
        },
        async createOrganization(data) {
          return tx.organization.create({
            data,
            select: { id: true, name: true },
          });
        },
        async createOwnerMembership(data) {
          await tx.organizationMember.create({
            data: { ...data, role: "OWNER" },
          });
        },
        async createBusinessProfile(data) {
          await tx.businessProfile.create({ data });
        },
        async createAgentSettings(organizationId) {
          await tx.agentSettings.create({ data: { organizationId } });
        },
        async findUserTrial(candidateUserId) {
          const trial = await tx.userTrial.findUnique({
            where: { userId: candidateUserId },
            select: { startedAt: true, endsAt: true },
          });
          return trial;
        },
        async createUserTrial(data) {
          await tx.userTrial.create({
            data: {
              userId: data.userId,
              startedAt: data.startedAt,
              endsAt: data.endsAt,
            },
          });
        },
        async createTrialSubscription(data) {
          const subscription = await tx.organizationSubscription.create({
            data: {
              organizationId: data.organizationId,
              plan: "STANDARD",
              status: "TRIALING",
              trialStartedAt: data.startedAt,
              trialEndsAt: data.endsAt,
            },
            select: { id: true },
          });
          await tx.billingEvent.create({
            data: {
              organizationId: data.organizationId,
              subscriptionId: subscription.id,
              provider: null,
              idempotencyKey: `trial:${data.organizationId}`,
              eventType: "trial.started",
              nextStatus: "TRIALING",
              payloadHash: createHash("sha256")
                .update(`trial.started:${data.organizationId}`, "utf8")
                .digest("hex"),
              status: "PROCESSED",
              occurredAt: data.startedAt,
              processedAt: data.startedAt,
            },
          });
        },
        async setActiveOrganization(data) {
          await tx.activeOrganizationSelection.upsert({
            where: { userId: data.userId },
            create: data,
            update: { organizationId: data.organizationId },
          });
        },
      });
    });
  },
};

function errorMetadata(error: unknown) {
  if (!error || typeof error !== "object") {
    return { type: typeof error, code: null };
  }
  const candidate = error as { name?: unknown; code?: unknown };
  return {
    type: typeof candidate.name === "string" ? candidate.name : "Error",
    code: typeof candidate.code === "string" ? candidate.code : null,
  };
}

function createOrganizationFailure(
  error: unknown,
  userId: string | null
): { ok: false; error: string } {
  const publicError = toPublicOnboardingError(error);
  if (publicError === "No pudimos crear el negocio. Intentá nuevamente en unos segundos.") {
    console.error("[VantixApp] Falló la creación inicial de la organización.", {
      userId,
      ...errorMetadata(error),
    });
  }
  return { ok: false, error: publicError };
}

/**
 * Crea la organización inicial del usuario (onboarding o registro).
 * Es idempotente: si el usuario ya pertenece a una organización, no hace nada.
 */
export async function createOrganization(
  input: CreateOrganizationInput
): Promise<ActionResult> {
  let userId: string | null = null;
  try {
    const user = await getSessionUser();
    userId = user.id;
    const result = await createInitialOrganization(
      user.id,
      input,
      initialOrganizationDependencies
    );

    if (result.created) {
      await recordAudit({
        organizationId: result.organization.id,
        userId: user.id,
        action: "organizacion.creada",
        entityType: "organization",
        entityId: result.organization.id,
        details: { nombre: result.organization.name },
      });
    }

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return createOrganizationFailure(error, userId);
  }
}

/**
 * Acción progresiva del formulario de onboarding. Al estar enlazada mediante
 * `action`, el botón sigue enviando aun antes de que React termine de hidratar.
 */
export async function submitCreateOrganization(
  previousState: CreateOrganizationFormState,
  formData: FormData
): Promise<CreateOrganizationFormState> {
  const submittedName = String(formData.get("name") ?? "");
  const parsed = createOrganizationSchema.safeParse({ name: submittedName });
  if (!parsed.success) {
    return {
      status: "error",
      error: null,
      fieldError:
        parsed.error.issues[0]?.message ?? "Revisá el nombre del negocio.",
      submittedName,
      attempt: previousState.attempt + 1,
    };
  }

  const result = await createOrganization(parsed.data);
  if (!result.ok) {
    return {
      status: "error",
      error: result.error,
      fieldError: null,
      submittedName: parsed.data.name,
      attempt: previousState.attempt + 1,
    };
  }

  redirect(ONBOARDING_NEXT_PATH);
}

export async function renameOrganization(
  input: RenameOrganizationInput
): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext({
      allowInactiveSubscription: true,
    });
    requirePermission(role, "org.update");
    const data = renameOrganizationSchema.parse(input);

    await prisma.organization.update({
      where: { id: org.id },
      data: { name: data.name },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "organizacion.renombrada",
      entityType: "organization",
      entityId: org.id,
      details: { nombre: data.name, anterior: org.name },
    });

    revalidatePath("/dashboard", "layout");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * Elimina la organización y todos sus datos (cascada).
 * Solo el propietario puede hacerlo.
 */
export async function deleteOrganization(): Promise<ActionResult> {
  try {
    const { org, role } = await getOrgContext({
      allowInactiveSubscription: true,
    });
    requirePermission(role, "org.delete");

    await prisma.organization.delete({ where: { id: org.id } });

    revalidatePath("/dashboard", "layout");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
