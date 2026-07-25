import { redirect } from "next/navigation";
import type { MemberRole } from "@/generated/prisma/enums";
import { ActionError } from "@/server/errors";
import {
  findActiveMembership,
  getSession,
  isVerifiedUser,
  PENDING_VERIFICATION_PATH,
} from "@/server/context";
import { getOnboardingState } from "@/server/organizations/onboarding-state";
import type {
  OnboardingState,
  OnboardingStep,
} from "@/server/organizations/onboarding-progress";

/**
 * Contexto de las pantallas y acciones del onboarding.
 *
 * El `organizationId` sale SIEMPRE de la membresía asociada a la sesión: no
 * hay ningún camino por el que el navegador pueda elegir sobre qué
 * organización se opera, así que no existe el IDOR por parámetro.
 */

export type OnboardingContext = {
  user: { id: string; name: string; email: string };
  org: { id: string; name: string };
  role: MemberRole;
  state: OnboardingState;
};

/** Solo quien administra el negocio puede configurarlo. */
const ONBOARDING_ROLES: readonly MemberRole[] = ["OWNER", "ADMIN"];

export function canRunOnboarding(role: MemberRole): boolean {
  return ONBOARDING_ROLES.includes(role);
}

/**
 * Para páginas del onboarding. Redirige en vez de lanzar:
 * sin sesión → login, sin verificar → pantalla de espera,
 * sin organización → primer paso, sin permisos → dashboard.
 */
export async function requireOnboardingContext(): Promise<OnboardingContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isVerifiedUser(session.user)) redirect(PENDING_VERIFICATION_PATH);

  const membership = await findActiveMembership(session.user.id);
  if (!membership) redirect("/onboarding");

  if (!canRunOnboarding(membership.role)) {
    // Un AGENT o VIEWER no configura el negocio; su lugar es el dashboard.
    redirect("/dashboard");
  }

  const state = await getOnboardingState(membership.organization.id);
  if (!state) redirect("/onboarding");

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    org: {
      id: membership.organization.id,
      name: membership.organization.name,
    },
    role: membership.role,
    state,
  };
}

/**
 * Para server actions del onboarding. Lanza `ActionError` con mensajes aptos
 * para mostrar: nunca filtra detalles internos.
 */
export async function getOnboardingActionContext(): Promise<OnboardingContext> {
  const session = await getSession();
  if (!session) throw new ActionError("Tenés que iniciar sesión para continuar.");
  if (!isVerifiedUser(session.user)) {
    throw new ActionError(
      "Confirmá tu correo para continuar. Te enviamos un enlace de verificación."
    );
  }

  const membership = await findActiveMembership(session.user.id);
  if (!membership) {
    throw new ActionError("Primero creá tu negocio para continuar.");
  }
  if (!canRunOnboarding(membership.role)) {
    throw new ActionError("No tenés permisos para configurar este negocio.");
  }

  const state = await getOnboardingState(membership.organization.id);
  if (!state) throw new ActionError("No encontramos la configuración de tu negocio.");

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    org: {
      id: membership.organization.id,
      name: membership.organization.name,
    },
    role: membership.role,
    state,
  };
}

/**
 * Comprueba que el paso pedido sea alcanzable. Si no lo es, redirige al que
 * corresponde: escribir la URL de un paso posterior a mano no saltea nada.
 */
export function redirectIfStepLocked(
  state: OnboardingState,
  requested: OnboardingStep
): void {
  const target = state.steps.find((step) => step.step === requested);
  if (!target) redirect("/onboarding");
  if (target.locked) {
    const next = state.steps.find((step) => step.step === state.nextStep);
    redirect(next?.path ?? "/onboarding");
  }
}
