import type { MemberRole } from "@/generated/prisma/enums";

/**
 * Qué hacer con cada organización cuando alguien borra su cuenta.
 *
 * La regla es no destruir trabajo ajeno: una organización solo se elimina si
 * la persona que se va era su único integrante. Si hay más gente, la
 * organización sobrevive y únicamente se quita esa membresía; y si además la
 * persona era la propietaria, hay que pasarle la propiedad a alguien antes de
 * irse para no dejar el espacio sin dueño.
 *
 * Es lógica pura para poder cubrir con tests los casos raros (última persona,
 * dueño único con equipo, varios candidatos) sin tocar PostgreSQL.
 */

/** Frase exacta que hay que escribir para confirmar. */
export const DELETE_ACCOUNT_PHRASE = "ELIMINAR MI CUENTA";
export const DELETE_ORGANIZATION_PHRASE = "ELIMINAR";

/** Prioridad para heredar la propiedad: primero ADMIN, después el resto. */
const SUCCESSION: MemberRole[] = ["ADMIN", "AGENT", "VIEWER"];

export type OrganizationMemberSummary = {
  userId: string;
  role: MemberRole;
  /** Para desempatar: gana quien entró primero. */
  createdAt: Date;
};

export type OrganizationDeletionPlan =
  | { organizationId: string; action: "delete" }
  | { organizationId: string; action: "leave" }
  | { organizationId: string; action: "transfer"; newOwnerUserId: string };

/**
 * Decide el destino de una organización.
 *
 * `members` incluye a la persona que se va.
 */
export function planOrganizationOnAccountDeletion(input: {
  organizationId: string;
  leavingUserId: string;
  members: OrganizationMemberSummary[];
}): OrganizationDeletionPlan {
  const others = input.members.filter((m) => m.userId !== input.leavingUserId);

  // Última persona: la organización se va con ella.
  if (others.length === 0) {
    return { organizationId: input.organizationId, action: "delete" };
  }

  const leaving = input.members.find((m) => m.userId === input.leavingUserId);

  // Si no era la dueña, alcanza con quitar su membresía.
  if (leaving?.role !== "OWNER") {
    return { organizationId: input.organizationId, action: "leave" };
  }

  // Si queda otra persona con rol OWNER, el espacio ya tiene dueño.
  if (others.some((m) => m.role === "OWNER")) {
    return { organizationId: input.organizationId, action: "leave" };
  }

  // Hay que heredar la propiedad: el ADMIN más antiguo, y si no hay, el
  // integrante más antiguo del rol más alto disponible.
  const candidates = [...others].sort((a, b) => {
    const byRole = SUCCESSION.indexOf(a.role) - SUCCESSION.indexOf(b.role);
    if (byRole !== 0) return byRole;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return {
    organizationId: input.organizationId,
    action: "transfer",
    newOwnerUserId: candidates[0]!.userId,
  };
}

export type AccountDeletionPlan = {
  organizationsToDelete: string[];
  organizationsToLeave: string[];
  transfers: { organizationId: string; newOwnerUserId: string }[];
};

export function planAccountDeletion(input: {
  leavingUserId: string;
  organizations: {
    organizationId: string;
    members: OrganizationMemberSummary[];
  }[];
}): AccountDeletionPlan {
  const plan: AccountDeletionPlan = {
    organizationsToDelete: [],
    organizationsToLeave: [],
    transfers: [],
  };

  for (const organization of input.organizations) {
    const decision = planOrganizationOnAccountDeletion({
      organizationId: organization.organizationId,
      leavingUserId: input.leavingUserId,
      members: organization.members,
    });

    if (decision.action === "delete") {
      plan.organizationsToDelete.push(decision.organizationId);
    } else if (decision.action === "leave") {
      plan.organizationsToLeave.push(decision.organizationId);
    } else {
      plan.transfers.push({
        organizationId: decision.organizationId,
        newOwnerUserId: decision.newOwnerUserId,
      });
    }
  }

  return plan;
}

/** Compara la frase escrita con la esperada, tolerando espacios y mayúsculas. */
export function isConfirmationPhraseValid(
  written: string,
  expected: string
): boolean {
  return written.trim().replace(/\s+/g, " ").toUpperCase() === expected;
}

export type DeletionCredentialRequirement = "password" | "recent_session";

/**
 * Qué se le exige a la persona para confirmar que es ella.
 *
 * Con contraseña propia se le pide la contraseña. Si solo entra con Google no
 * hay contraseña que pedir, así que se exige que la sesión sea reciente: quien
 * se robó una sesión vieja no puede borrar la cuenta.
 */
export function credentialRequirementFor(input: {
  hasCredentialAccount: boolean;
}): DeletionCredentialRequirement {
  return input.hasCredentialAccount ? "password" : "recent_session";
}

/** Ventana para considerar "reciente" una sesión en acciones destructivas. */
export const RECENT_SESSION_MAX_AGE_MS = 60 * 60 * 1000;

export function isSessionRecentEnough(input: {
  sessionCreatedAt: Date;
  now: Date;
  maxAgeMs?: number;
}): boolean {
  const maxAge = input.maxAgeMs ?? RECENT_SESSION_MAX_AGE_MS;
  return input.now.getTime() - input.sessionCreatedAt.getTime() <= maxAge;
}
