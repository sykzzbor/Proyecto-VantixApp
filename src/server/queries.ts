import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { AgentTone, InvitationStatus, MemberRole } from "@/generated/prisma/enums";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDuration,
} from "@/lib/format";

export type StatusFilter = "activos" | "inactivos" | undefined;

// ============================================================
// Productos
// ============================================================

export type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  priceLabel: string;
  stock: number;
  category: string | null;
  active: boolean;
  updatedAtLabel: string;
};

export async function getProducts(
  organizationId: string,
  filters: { q?: string; category?: string; status?: StatusFilter }
): Promise<ProductRow[]> {
  const where: Prisma.ProductWhereInput = { organizationId };
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: "insensitive" } },
      { description: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  if (filters.category) where.category = filters.category;
  if (filters.status) where.active = filters.status === "activos";

  const rows = await prisma.product.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price.toNumber(),
    priceLabel: formatCurrency(p.price.toNumber()),
    stock: p.stock,
    category: p.category,
    active: p.active,
    updatedAtLabel: formatDate(p.updatedAt),
  }));
}

export async function getProductCategories(organizationId: string): Promise<string[]> {
  const rows = await prisma.product.findMany({
    where: { organizationId, category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows.flatMap((r) => (r.category ? [r.category] : []));
}

// ============================================================
// Servicios
// ============================================================

export type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  priceLabel: string;
  durationMinutes: number;
  durationLabel: string;
  active: boolean;
  updatedAtLabel: string;
};

export async function getServices(
  organizationId: string,
  filters: { q?: string; status?: StatusFilter }
): Promise<ServiceRow[]> {
  const where: Prisma.ServiceWhereInput = { organizationId };
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: "insensitive" } },
      { description: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  if (filters.status) where.active = filters.status === "activos";

  const rows = await prisma.service.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    price: s.price.toNumber(),
    priceLabel: formatCurrency(s.price.toNumber()),
    durationMinutes: s.durationMinutes,
    durationLabel: formatDuration(s.durationMinutes),
    active: s.active,
    updatedAtLabel: formatDate(s.updatedAt),
  }));
}

// ============================================================
// Preguntas frecuentes
// ============================================================

export type FaqRow = {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  active: boolean;
  updatedAtLabel: string;
};

export async function getFaqs(
  organizationId: string,
  filters: { q?: string; category?: string; status?: StatusFilter }
): Promise<FaqRow[]> {
  const where: Prisma.FaqWhereInput = { organizationId };
  if (filters.q) {
    where.OR = [
      { question: { contains: filters.q, mode: "insensitive" } },
      { answer: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  if (filters.category) where.category = filters.category;
  if (filters.status) where.active = filters.status === "activos";

  const rows = await prisma.faq.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  return rows.map((f) => ({
    id: f.id,
    question: f.question,
    answer: f.answer,
    category: f.category,
    active: f.active,
    updatedAtLabel: formatDate(f.updatedAt),
  }));
}

export async function getFaqCategories(organizationId: string): Promise<string[]> {
  const rows = await prisma.faq.findMany({
    where: { organizationId, category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows.flatMap((r) => (r.category ? [r.category] : []));
}

// ============================================================
// Negocio y agente
// ============================================================

export async function getBusinessProfile(organizationId: string) {
  return prisma.businessProfile.findUnique({ where: { organizationId } });
}

export async function getAgentSettings(organizationId: string) {
  return prisma.agentSettings.findUnique({ where: { organizationId } });
}

// ============================================================
// Equipo
// ============================================================

export type MemberRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  joinedLabel: string;
};

export async function getTeamMembers(organizationId: string): Promise<MemberRow[]> {
  const rows = await prisma.organizationMember.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({
    id: m.id,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    joinedLabel: formatDate(m.createdAt),
  }));
}

export type InvitationRow = {
  id: string;
  email: string;
  role: MemberRole;
  status: InvitationStatus;
  token: string;
  expiresLabel: string;
  expired: boolean;
  invitedByName: string | null;
};

export async function getPendingInvitations(
  organizationId: string
): Promise<InvitationRow[]> {
  const rows = await prisma.invitation.findMany({
    where: { organizationId, status: "PENDING" },
    include: { invitedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    status: i.status,
    token: i.token,
    expiresLabel: formatDate(i.expiresAt),
    expired: i.expiresAt < new Date(),
    invitedByName: i.invitedBy?.name ?? null,
  }));
}

export type InvitationDetails = {
  organizationName: string;
  email: string;
  role: MemberRole;
  status: InvitationStatus;
  expired: boolean;
};

export async function getInvitationByToken(
  token: string
): Promise<InvitationDetails | null> {
  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { organization: { select: { name: true } } },
  });
  if (!invitation) return null;
  return {
    organizationName: invitation.organization.name,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expired: invitation.expiresAt < new Date(),
  };
}

// ============================================================
// Auditoría
// ============================================================

export type AuditRow = {
  id: string;
  action: string;
  entityType: string | null;
  userName: string | null;
  dateLabel: string;
  details: string | null;
};

export async function getAuditLogs(
  organizationId: string,
  limit = 20
): Promise<AuditRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: { organizationId },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    userName: log.user?.name ?? null,
    dateLabel: formatDateTime(log.createdAt),
    details: extractDetailLabel(log.details),
  }));
}

function extractDetailLabel(details: Prisma.JsonValue | null): string | null {
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const record = details as Record<string, unknown>;
    const label = record["nombre"] ?? record["email"] ?? record["titulo"];
    return typeof label === "string" ? label : null;
  }
  return null;
}

// ============================================================
// Resumen del dashboard
// ============================================================

export type DashboardSummary = {
  productsTotal: number;
  productsActive: number;
  servicesTotal: number;
  servicesActive: number;
  faqsTotal: number;
  faqsActive: number;
  membersCount: number;
  agent: { enabled: boolean; assistantName: string; tone: AgentTone } | null;
  businessComplete: boolean;
  recentActivity: AuditRow[];
};

export async function getDashboardSummary(
  organizationId: string
): Promise<DashboardSummary> {
  const [
    productsTotal,
    productsActive,
    servicesTotal,
    servicesActive,
    faqsTotal,
    faqsActive,
    membersCount,
    agentSettings,
    businessProfile,
    recentActivity,
  ] = await Promise.all([
    prisma.product.count({ where: { organizationId } }),
    prisma.product.count({ where: { organizationId, active: true } }),
    prisma.service.count({ where: { organizationId } }),
    prisma.service.count({ where: { organizationId, active: true } }),
    prisma.faq.count({ where: { organizationId } }),
    prisma.faq.count({ where: { organizationId, active: true } }),
    prisma.organizationMember.count({ where: { organizationId } }),
    prisma.agentSettings.findUnique({ where: { organizationId } }),
    prisma.businessProfile.findUnique({ where: { organizationId } }),
    getAuditLogs(organizationId, 8),
  ]);

  const businessComplete = Boolean(
    businessProfile &&
      businessProfile.description &&
      businessProfile.phone &&
      businessProfile.address
  );

  return {
    productsTotal,
    productsActive,
    servicesTotal,
    servicesActive,
    faqsTotal,
    faqsActive,
    membersCount,
    agent: agentSettings
      ? {
          enabled: agentSettings.enabled,
          assistantName: agentSettings.assistantName,
          tone: agentSettings.tone,
        }
      : null,
    businessComplete,
    recentActivity,
  };
}
