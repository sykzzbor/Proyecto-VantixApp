import type { MemberRole } from "@/generated/prisma/enums";

export const ROLE_LABELS: Record<MemberRole, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  AGENT: "Agente",
  VIEWER: "Lector",
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  OWNER: "Control total, incluida la eliminación de la organización.",
  ADMIN: "Gestiona el negocio, el catálogo, el agente y el equipo.",
  AGENT: "Crea y edita productos, servicios y preguntas frecuentes.",
  VIEWER: "Solo puede ver la información.",
};

const PERMISSIONS = {
  "business.update": ["OWNER", "ADMIN"],
  "catalog.create": ["OWNER", "ADMIN", "AGENT"],
  "catalog.update": ["OWNER", "ADMIN", "AGENT"],
  "catalog.delete": ["OWNER", "ADMIN"],
  "agent.update": ["OWNER", "ADMIN"],
  "whatsapp.manage": ["OWNER", "ADMIN"],
  "inbox.respond": ["OWNER", "ADMIN", "AGENT"],
  "inbox.manage": ["OWNER", "ADMIN"],
  "customers.update": ["OWNER", "ADMIN"],
  "team.manage": ["OWNER", "ADMIN"],
  "org.update": ["OWNER", "ADMIN"],
  "org.delete": ["OWNER"],
  "audit.read": ["OWNER", "ADMIN"],
  "knowledge.read": ["OWNER", "ADMIN", "AGENT", "VIEWER"],
  "knowledge.manage": ["OWNER", "ADMIN"],
  "knowledge.delete": ["OWNER", "ADMIN"],
  "metrics.read": ["OWNER", "ADMIN", "AGENT", "VIEWER"],
  "metrics.advanced": ["OWNER", "ADMIN"],
  "automation.manage": ["OWNER", "ADMIN"],
} as const satisfies Record<string, readonly MemberRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: MemberRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly MemberRole[]).includes(role);
}

/**
 * Roles que un miembro puede asignar al invitar o al cambiar el rol de otro.
 * El rol OWNER nunca se asigna desde la interfaz.
 */
export function assignableRoles(role: MemberRole): MemberRole[] {
  if (role === "OWNER") return ["ADMIN", "AGENT", "VIEWER"];
  if (role === "ADMIN") return ["AGENT", "VIEWER"];
  return [];
}
