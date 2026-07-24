/**
 * Resumen operativo del panel principal.
 *
 * Vive aparte de `src/server/queries.ts` (que sigue alimentando el catálogo y la
 * actividad reciente) porque agrega datos de período, plan, integraciones,
 * agenda y pedidos. Todas las consultas filtran SIEMPRE por `organizationId`,
 * que viene de la sesión y nunca del navegador.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";
import { getPlanRules, getUsageSnapshot } from "@/server/billing/rules";
import { sanitizeAutomationMessage } from "@/server/automation/sanitization";
import { ACTIVE_STATUSES } from "@/server/appointments/service";
import { METRICS_TIMEZONE, type MetricsRange } from "@/server/metrics/range";

export type IntegrationHealth = "connected" | "error" | "disconnected";

export type IntegrationStatus = {
  key: string;
  label: string;
  health: IntegrationHealth;
  detail: string;
  href: string;
};

export type UpcomingAppointment = {
  id: string;
  whenLabel: string;
  customerName: string;
  title: string;
  rescheduled: boolean;
};

export type RecentOrder = {
  id: string;
  source: "Tiendanube" | "WooCommerce";
  reference: string;
  customerName: string | null;
  total: string | null;
  status: string;
  whenLabel: string;
};

export type UsageMeter = {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
};

export type DashboardAlert = {
  key: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  severity: "warning" | "danger";
};

export type DashboardOverview = {
  rangeLabel: string;
  conversations: {
    total: number;
    open: number;
    pending: number;
    closed: number;
  };
  aiReplies: number;
  humanReplies: number;
  handoffs: number;
  handoffRatePct: number;
  avgFirstResponseSeconds: number | null;
  newCustomers: number;
  plan: {
    name: string;
    conversations: UsageMeter;
    aiResponses: UsageMeter;
    resetsAt: string;
  };
  integrations: IntegrationStatus[];
  upcomingAppointments: UpcomingAppointment[];
  recentOrders: RecentOrder[];
  alerts: DashboardAlert[];
};

const dateTimeLabel = new Intl.DateTimeFormat("es-AR", {
  timeZone: METRICS_TIMEZONE,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateLabel = new Intl.DateTimeFormat("es-AR", {
  timeZone: METRICS_TIMEZONE,
  day: "2-digit",
  month: "long",
  year: "numeric",
});

/** Fecha del turno en su propia zona; si es inválida, cae a la del panel. */
function formatAppointmentStart(startAt: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      timeZone,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(startAt);
  } catch {
    return dateTimeLabel.format(startAt);
  }
}

export function meter(used: number, limit: number): UsageMeter {
  const safeLimit = limit > 0 ? limit : 0;
  const cappedUsed = Math.max(0, used);
  return {
    used: cappedUsed,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - cappedUsed),
    percent: safeLimit > 0 ? Math.min(100, Math.round((cappedUsed / safeLimit) * 100)) : 0,
  };
}

/** Primer día del mes siguiente: cuando se reinician los contadores de uso. */
export function nextPeriodReset(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export async function getDashboardOverview(
  organizationId: string,
  range: MetricsRange,
  now = new Date()
): Promise<DashboardOverview> {
  const { from, to } = range;
  const period = { gte: from, lt: to };

  const [
    statusGroups,
    messageGroups,
    handoffs,
    newCustomers,
    timing,
    entitlement,
    usage,
    appointments,
    tiendanubeOrders,
    wooOrders,
    whatsapp,
    calendar,
    sheets,
    tiendanube,
    woocommerce,
  ] = await Promise.all([
    prisma.conversation.groupBy({
      by: ["status"],
      where: { organizationId, createdAt: period },
      _count: { _all: true },
    }),
    prisma.message.groupBy({
      by: ["senderType"],
      where: { organizationId, createdAt: period },
      _count: { _all: true },
    }),
    prisma.conversation.count({
      where: { organizationId, humanTakeoverAt: period },
    }),
    prisma.customer.count({ where: { organizationId, createdAt: period } }),
    prisma.$queryRaw<{ avg_first_response: number | null }[]>(Prisma.sql`
      WITH conv AS (
        SELECT c.id
        FROM "conversations" c
        WHERE c."organizationId" = ${organizationId}
          AND c."createdAt" >= ${from} AND c."createdAt" < ${to}
      ),
      first_customer AS (
        SELECT m."conversationId" AS cid, MIN(m."createdAt") AS t
        FROM "messages" m JOIN conv ON conv.id = m."conversationId"
        WHERE m."senderType" = 'CUSTOMER'
        GROUP BY m."conversationId"
      ),
      first_reply AS (
        SELECT m."conversationId" AS cid, MIN(m."createdAt") AS t
        FROM "messages" m JOIN first_customer fc ON fc.cid = m."conversationId"
        WHERE m."senderType" IN ('AI','HUMAN') AND m."createdAt" >= fc.t
        GROUP BY m."conversationId"
      )
      SELECT AVG(EXTRACT(EPOCH FROM (fr.t - fc.t)))::float8 AS avg_first_response
      FROM first_customer fc JOIN first_reply fr ON fr.cid = fc.cid
    `),
    getOrganizationEntitlement(organizationId, now),
    getUsageSnapshot(organizationId, now),
    prisma.appointment.findMany({
      where: {
        organizationId,
        startAt: { gte: now },
        // Misma definición de "turno vigente" que la agenda, incluidos los
        // reprogramados: si se listaran solo PENDING/CONFIRMED desaparecerían
        // del panel turnos que sí están en pie.
        status: { in: ACTIVE_STATUSES },
      },
      orderBy: { startAt: "asc" },
      take: 5,
      select: {
        id: true,
        startAt: true,
        customerName: true,
        title: true,
        status: true,
        timezone: true,
      },
    }),
    prisma.tiendanubeOrder.findMany({
      where: { organizationId },
      orderBy: { remoteCreatedAt: { sort: "desc", nulls: "last" } },
      take: 5,
      select: {
        id: true,
        orderNumber: true,
        externalId: true,
        status: true,
        total: true,
        currency: true,
        customerName: true,
        remoteCreatedAt: true,
        createdAt: true,
      },
    }),
    prisma.wooCommerceOrder.findMany({
      where: { organizationId },
      orderBy: { remoteCreatedAt: { sort: "desc", nulls: "last" } },
      take: 5,
      select: {
        id: true,
        orderNumber: true,
        externalId: true,
        status: true,
        total: true,
        currency: true,
        customerName: true,
        remoteCreatedAt: true,
        createdAt: true,
      },
    }),
    prisma.whatsappIntegration.findFirst({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      select: { status: true, displayPhoneNumber: true, lastError: true },
    }),
    prisma.googleCalendarConnection.findUnique({
      where: { organizationId },
      select: { status: true, selectedCalendarName: true, lastError: true },
    }),
    prisma.googleSheetsConnection.findUnique({
      where: { organizationId },
      select: { status: true, lastSyncedAt: true, lastError: true },
    }),
    prisma.tiendanubeConnection.findUnique({
      where: { organizationId },
      select: { status: true, storeName: true, lastError: true },
    }),
    prisma.wooCommerceConnection.findUnique({
      where: { organizationId },
      select: { status: true, storeName: true, lastError: true },
    }),
  ]);

  const statusCount = (status: string) =>
    statusGroups.find((group) => group.status === status)?._count._all ?? 0;
  const open = statusCount("OPEN");
  const pending = statusCount("PENDING");
  const closed = statusCount("CLOSED");
  const total = open + pending + closed;

  const messageCount = (type: string) =>
    messageGroups.find((group) => group.senderType === type)?._count._all ?? 0;
  const aiReplies = messageCount("AI");
  const humanReplies = messageCount("HUMAN");

  const limits = getPlanRules(entitlement).limits;

  const integrations: IntegrationStatus[] = [
    buildIntegration({
      key: "whatsapp",
      label: "WhatsApp",
      href: "/dashboard/integraciones/whatsapp",
      connected: whatsapp?.status === "CONNECTED",
      errored: whatsapp?.status === "ERROR",
      present: Boolean(whatsapp),
      connectedDetail: whatsapp?.displayPhoneNumber ?? "Conectado",
      lastError: whatsapp?.lastError ?? null,
    }),
    buildIntegration({
      key: "google-calendar",
      label: "Google Calendar",
      href: "/dashboard/integraciones/google-calendar",
      connected: calendar?.status === "CONNECTED",
      errored: calendar?.status === "ERROR",
      present: Boolean(calendar),
      connectedDetail: calendar?.selectedCalendarName ?? "Agenda conectada",
      lastError: calendar?.lastError ?? null,
    }),
    buildIntegration({
      key: "google-sheets",
      label: "Google Sheets",
      href: "/dashboard/integraciones/google-sheets",
      connected: sheets?.status === "CONNECTED",
      errored: sheets?.status === "ERROR",
      present: Boolean(sheets),
      connectedDetail: sheets?.lastSyncedAt
        ? `Última exportación ${dateTimeLabel.format(sheets.lastSyncedAt)}`
        : "Sin exportaciones todavía",
      lastError: sheets?.lastError ?? null,
    }),
    buildIntegration({
      key: "tiendanube",
      label: "Tiendanube",
      href: "/dashboard/integraciones/tiendanube",
      connected: tiendanube?.status === "CONNECTED",
      errored: tiendanube?.status === "ERROR",
      present: Boolean(tiendanube),
      connectedDetail: tiendanube?.storeName ?? "Tienda conectada",
      lastError: tiendanube?.lastError ?? null,
    }),
    buildIntegration({
      key: "woocommerce",
      label: "WooCommerce",
      href: "/dashboard/integraciones/woocommerce",
      connected: woocommerce?.status === "CONNECTED",
      errored: woocommerce?.status === "ERROR",
      present: Boolean(woocommerce),
      connectedDetail: woocommerce?.storeName ?? "Tienda conectada",
      lastError: woocommerce?.lastError ?? null,
    }),
  ];

  const recentOrders = [
    ...tiendanubeOrders.map((order) =>
      toRecentOrder(order, "Tiendanube" as const)
    ),
    ...wooOrders.map((order) => toRecentOrder(order, "WooCommerce" as const)),
  ]
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, 6)
    .map((entry) => entry.order);

  const conversationsMeter = meter(usage.conversations, limits.conversationsPerMonth);
  const aiResponsesMeter = meter(usage.aiResponses, limits.aiResponsesPerMonth);

  return {
    rangeLabel: range.label,
    conversations: { total, open, pending, closed },
    aiReplies,
    humanReplies,
    handoffs,
    handoffRatePct: total > 0 ? Math.round((handoffs / total) * 100) : 0,
    avgFirstResponseSeconds: timing[0]?.avg_first_response ?? null,
    newCustomers,
    plan: {
      name: BILLING_PLANS[entitlement.plan].name,
      conversations: conversationsMeter,
      aiResponses: aiResponsesMeter,
      resetsAt: dateLabel.format(nextPeriodReset(now)),
    },
    integrations,
    upcomingAppointments: appointments.map((appointment) => ({
      id: appointment.id,
      // Cada turno guarda su propia zona horaria: se muestra en la del turno,
      // no en la de la organización.
      whenLabel: formatAppointmentStart(
        appointment.startAt,
        appointment.timezone
      ),
      customerName: appointment.customerName,
      title: appointment.title,
      rescheduled: appointment.status === "RESCHEDULED",
    })),
    recentOrders,
    alerts: buildAlerts({
      entitlement,
      integrations,
      conversationsMeter,
      aiResponsesMeter,
      pending,
    }),
  };
}

function buildIntegration(input: {
  key: string;
  label: string;
  href: string;
  present: boolean;
  connected: boolean;
  errored: boolean;
  connectedDetail: string;
  lastError: string | null;
}): IntegrationStatus {
  if (!input.present) {
    return {
      key: input.key,
      label: input.label,
      health: "disconnected",
      detail: "Sin conectar",
      href: input.href,
    };
  }
  if (input.errored) {
    return {
      key: input.key,
      label: input.label,
      health: "error",
      // Los mensajes de proveedor pueden traer datos sensibles: se sanean.
      detail:
        sanitizeAutomationMessage(input.lastError) ?? "Requiere revisión",
      href: input.href,
    };
  }
  return {
    key: input.key,
    label: input.label,
    health: input.connected ? "connected" : "disconnected",
    detail: input.connected ? input.connectedDetail : "Sin conectar",
    href: input.href,
  };
}

type OrderRow = {
  id: string;
  orderNumber: string | null;
  externalId: string;
  status: string;
  total: Prisma.Decimal | null;
  currency: string | null;
  customerName: string | null;
  remoteCreatedAt: Date | null;
  createdAt: Date;
};

function toRecentOrder(
  order: OrderRow,
  source: RecentOrder["source"]
): { sortKey: number; order: RecentOrder } {
  const when = order.remoteCreatedAt ?? order.createdAt;
  return {
    sortKey: when.getTime(),
    order: {
      id: `${source}-${order.id}`,
      source,
      reference: order.orderNumber
        ? `#${order.orderNumber}`
        : `#${order.externalId}`,
      customerName: order.customerName,
      total:
        order.total !== null
          ? `${order.currency ?? ""} ${order.total.toFixed(2)}`.trim()
          : null,
      status: order.status,
      whenLabel: dateTimeLabel.format(when),
    },
  };
}

export function buildAlerts(input: {
  entitlement: Awaited<ReturnType<typeof getOrganizationEntitlement>>;
  integrations: IntegrationStatus[];
  conversationsMeter: UsageMeter;
  aiResponsesMeter: UsageMeter;
  pending: number;
}): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  if (!input.entitlement.accessAllowed) {
    alerts.push({
      key: "suscripcion",
      title: "La suscripción no está activa",
      description:
        "El acceso al panel está limitado hasta regularizar el plan.",
      href: "/dashboard/planes",
      cta: "Ver planes",
      severity: "danger",
    });
  } else if (
    input.entitlement.status === "TRIALING" &&
    input.entitlement.remainingDays <= 2
  ) {
    alerts.push({
      key: "prueba",
      title:
        input.entitlement.remainingDays <= 0
          ? "La prueba termina hoy"
          : `La prueba termina en ${input.entitlement.remainingDays} día${input.entitlement.remainingDays === 1 ? "" : "s"}`,
      description: "Elegí un plan para no perder el acceso a la operación.",
      href: "/dashboard/planes",
      cta: "Elegir plan",
      severity: "warning",
    });
  }

  for (const [label, usage] of [
    ["conversaciones", input.conversationsMeter],
    ["respuestas de IA", input.aiResponsesMeter],
  ] as const) {
    if (usage.limit > 0 && usage.percent >= 80) {
      alerts.push({
        key: `uso-${label}`,
        title:
          usage.remaining === 0
            ? `Se agotaron las ${label} del mes`
            : `Usaste el ${usage.percent}% de las ${label} del mes`,
        description:
          usage.remaining === 0
            ? "Cambiá de plan para seguir operando este mes."
            : `Quedan ${usage.remaining} antes del reinicio.`,
        href: "/dashboard/planes",
        cta: "Ver planes",
        severity: usage.remaining === 0 ? "danger" : "warning",
      });
    }
  }

  for (const integration of input.integrations) {
    if (integration.health === "error") {
      alerts.push({
        key: `integracion-${integration.key}`,
        title: `${integration.label} requiere atención`,
        description: integration.detail,
        href: integration.href,
        cta: "Revisar",
        severity: "warning",
      });
    }
  }

  return alerts;
}
