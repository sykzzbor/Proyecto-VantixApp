import type { CreateOrganizationInput } from "@/lib/validations/business";
import { createOrganizationSchema } from "@/lib/validations/business";
import { slugify } from "@/lib/slug";
import { ActionError } from "@/server/errors";
import { ZodError } from "zod";
import { TRIAL_DURATION_MS } from "@/server/billing/entitlement";

export const ONBOARDING_NEXT_PATH = "/dashboard/integraciones";

export type InitialOrganization = {
  id: string;
  name: string;
};

export type InitialOrganizationResult = {
  organization: InitialOrganization;
  created: boolean;
};

export type InitialOrganizationTransaction = {
  userExists(userId: string): Promise<boolean>;
  findMembership(userId: string): Promise<InitialOrganization | null>;
  createOrganization(input: { name: string; slug: string }): Promise<InitialOrganization>;
  createOwnerMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<void>;
  createBusinessProfile(input: {
    organizationId: string;
    name: string;
  }): Promise<void>;
  createAgentSettings(organizationId: string): Promise<void>;
  createTrialSubscription(input: {
    organizationId: string;
    startedAt: Date;
    endsAt: Date;
  }): Promise<void>;
  setActiveOrganization(input: {
    organizationId: string;
    userId: string;
  }): Promise<void>;
};

export type InitialOrganizationDependencies = {
  runExclusive<T>(
    userId: string,
    operation: (transaction: InitialOrganizationTransaction) => Promise<T>
  ): Promise<T>;
  now?: () => Date;
};

export function toPublicOnboardingError(error: unknown): string {
  if (error instanceof ActionError) return error.message;
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "Revisá el nombre del negocio.";
  }
  return "No pudimos crear el negocio. Intentá nuevamente en unos segundos.";
}

/**
 * Crea el primer espacio de trabajo dentro de una sección exclusiva por usuario.
 * El bloqueo y la segunda lectura de membresía hacen que los reintentos y envíos
 * concurrentes recuperen la organización existente en vez de crear duplicados.
 */
export async function createInitialOrganization(
  userId: string,
  input: CreateOrganizationInput,
  dependencies: InitialOrganizationDependencies
): Promise<InitialOrganizationResult> {
  const data = createOrganizationSchema.parse(input);

  return dependencies.runExclusive(userId, async (transaction) => {
    if (!(await transaction.userExists(userId))) {
      throw new ActionError(
        "No encontramos tu usuario. Cerrá sesión e ingresá nuevamente para continuar."
      );
    }

    const existing = await transaction.findMembership(userId);
    if (existing) {
      return { organization: existing, created: false };
    }

    const organization = await transaction.createOrganization({
      name: data.name,
      slug: slugify(data.name),
    });
    await transaction.createOwnerMembership({
      organizationId: organization.id,
      userId,
    });
    await transaction.createBusinessProfile({
      organizationId: organization.id,
      name: data.name,
    });
    await transaction.createAgentSettings(organization.id);
    const trialStartedAt = dependencies.now?.() ?? new Date();
    await transaction.createTrialSubscription({
      organizationId: organization.id,
      startedAt: trialStartedAt,
      endsAt: new Date(trialStartedAt.getTime() + TRIAL_DURATION_MS),
    });
    await transaction.setActiveOrganization({
      organizationId: organization.id,
      userId,
    });

    return { organization, created: true };
  });
}
