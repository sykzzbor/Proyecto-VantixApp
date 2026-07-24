import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { getAnthropicModel } from "@/server/agent/config";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";
import { getPlanRules, getUsageSnapshot } from "@/server/billing/rules";
import { METRICS_TIMEZONE, type MetricsRange } from "@/server/metrics/range";

/**
 * Todas las métricas se calculan con agregaciones SQL, filtradas SIEMPRE por
 * organizationId (de la sesión, nunca del navegador). Definiciones exactas:
 */
export const METRIC_DEFINITIONS: { term: string; definition: string }[] = [
  {
    term: "Conversaciones recibidas",
    definition: "Conversaciones creadas dentro del período (y canal) seleccionado.",
  },
  {
    term: "Activas / Pendientes / Cerradas",
    definition:
      "Entre las conversaciones creadas en el período, su estado actual (OPEN / PENDING / CLOSED).",
  },
  {
    term: "Mensajes de clientes / Claude / humanos",
    definition:
      "Mensajes creados en el período según su emisor (CUSTOMER / AI / HUMAN). Los mensajes SYSTEM no cuentan como respuestas.",
  },
  {
    term: "Derivaciones",
    definition: "Conversaciones que pasaron a atención humana (humanTakeoverAt) dentro del período.",
  },
  {
    term: "% IA vs % humano",
    definition:
      "Sobre el total de respuestas (AI + HUMAN), la proporción de cada una. Excluye mensajes SYSTEM y de clientes.",
  },
  {
    term: "Tiempo de primera respuesta",
    definition:
      "Promedio entre el primer mensaje del cliente y la primera respuesta posterior (IA o humano) de la misma conversación.",
  },
  {
    term: "Tiempo de resolución",
    definition:
      "Promedio entre la creación y el cierre (closedAt) de las conversaciones cerradas del período. Las conversaciones abiertas no se consideran resueltas.",
  },
  {
    term: "Sin respuesta",
    definition:
      "Conversaciones con al menos un mensaje de cliente y ninguna respuesta de IA ni humana.",
  },
  {
    term: "Clientes nuevos",
    definition: "Clientes creados dentro del período.",
  },
  {
    term: "Uso de Claude",
    definition:
      "Eventos reales de uso del proveedor (tokens de entrada/salida, latencia, éxitos y errores) registrados por cada respuesta del agente. Sin costos monetarios.",
  },
  {
    term: "% de derivación",
    definition:
      "Derivaciones a humano sobre el total de conversaciones recibidas en el período.",
  },
  {
    term: "Consumo del plan",
    definition:
      "Contadores del mes en curso (conversaciones y respuestas de IA) frente al límite del plan. Se reinician el día 1 y no dependen del período elegido arriba.",
  },
  {
    term: "Pedidos sincronizados",
    definition:
      "Pedidos de Tiendanube o WooCommerce cuya fecha de creación en la tienda cae dentro del período. Solo lectura: VantixApp no crea pedidos.",
  },
  {
    term: "Errores de integraciones",
    definition:
      "Sincronizaciones fallidas dentro del período, más las conexiones que hoy están en estado de error.",
  },
];

export type MetricsChannel = "test" | "whatsapp";

export type PlanUsageMeter = {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
};

export type TeamMemberMetric = {
  userId: string;
  name: string;
  taken: number;
  humanMessages: number;
  closed: number;
  avgResponseSeconds: number | null;
};

export type MetricsData = {
  totals: {
    conversationsReceived: number;
    active: number;
    pending: number;
    closed: number;
    customerMessages: number;
    aiReplies: number;
    humanReplies: number;
    handoffs: number;
    newCustomers: number;
    unanswered: number;
    aiSharePct: number;
    humanSharePct: number;
    handoffRatePct: number;
    avgFirstResponseSeconds: number | null;
    avgResolutionSeconds: number | null;
  };
  planUsage: {
    planName: string;
    resetsAt: string;
    conversations: PlanUsageMeter;
    aiResponses: PlanUsageMeter;
  };
  orders: {
    total: number;
    bySource: { source: string; count: number }[];
  };
  integrationErrors: {
    total: number;
    items: { source: string; failedRuns: number; connectionInError: boolean }[];
  };
  conversationsByDay: { day: string; count: number }[];
  messagesByChannel: { channel: string; count: number }[];
  byHour: { hour: number; count: number }[];
  aiUsage: {
    requests: number;
    successes: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
    avgLatencyMs: number;
    toolCalls: number;
    activeModel: string;
  };
  toolUsage: { tool: string; count: number }[];
  knowledgeSearches: number;
  topProducts: { name: string; count: number }[];
  topServices: { name: string; count: number }[];
  team: TeamMemberMetric[];
  hasData: boolean;
};

function channelFilter(channel?: MetricsChannel) {
  return channel ? { channel } : {};
}

function channelSql(channel?: MetricsChannel) {
  return channel ? Prisma.sql`AND c."channel" = ${channel}` : Prisma.empty;
}

export async function getMetrics(
  organizationId: string,
  range: MetricsRange,
  channel?: MetricsChannel
): Promise<MetricsData> {
  const { from, to } = range;
  const period = { gte: from, lt: to };

  const [
    statusGroups,
    messageGroups,
    handoffs,
    newCustomers,
    timing,
    conversationsByDayRows,
    messagesByChannelRows,
    byHourRows,
    usageAgg,
    usageSuccess,
    usageModel,
    toolGroups,
    topProductsRows,
    topServicesRows,
    teamData,
    planUsage,
    orders,
    integrationErrors,
  ] = await Promise.all([
    prisma.conversation.groupBy({
      by: ["status"],
      where: { organizationId, createdAt: period, ...channelFilter(channel) },
      _count: { _all: true },
    }),
    prisma.message.groupBy({
      by: ["senderType"],
      where: {
        organizationId,
        createdAt: period,
        ...(channel ? { conversation: { channel } } : {}),
      },
      _count: { _all: true },
    }),
    prisma.conversation.count({
      where: {
        organizationId,
        humanTakeoverAt: period,
        ...channelFilter(channel),
      },
    }),
    prisma.customer.count({ where: { organizationId, createdAt: period } }),
    prisma.$queryRaw<
      { avg_first_response: number | null; avg_resolution: number | null; unanswered: number }[]
    >(Prisma.sql`
      WITH conv AS (
        SELECT c.id, c."createdAt", c."closedAt"
        FROM "conversations" c
        WHERE c."organizationId" = ${organizationId}
          AND c."createdAt" >= ${from} AND c."createdAt" < ${to}
          ${channelSql(channel)}
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
      SELECT
        AVG(EXTRACT(EPOCH FROM (fr.t - fc.t)))::float8 AS avg_first_response,
        (SELECT AVG(EXTRACT(EPOCH FROM (conv."closedAt" - conv."createdAt")))::float8
           FROM conv WHERE conv."closedAt" IS NOT NULL) AS avg_resolution,
        COUNT(*) FILTER (WHERE fr.cid IS NULL)::int AS unanswered
      FROM first_customer fc
      LEFT JOIN first_reply fr ON fr.cid = fc.cid
    `),
    prisma.$queryRaw<{ day: string; count: number }[]>(Prisma.sql`
      SELECT to_char(date_trunc('day', c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${METRICS_TIMEZONE}), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS count
      FROM "conversations" c
      WHERE c."organizationId" = ${organizationId}
        AND c."createdAt" >= ${from} AND c."createdAt" < ${to}
        ${channelSql(channel)}
      GROUP BY day ORDER BY day ASC
    `),
    prisma.$queryRaw<{ channel: string; count: number }[]>(Prisma.sql`
      SELECT c."channel" AS channel, COUNT(m.*)::int AS count
      FROM "messages" m JOIN "conversations" c ON c.id = m."conversationId"
      WHERE m."organizationId" = ${organizationId}
        AND m."createdAt" >= ${from} AND m."createdAt" < ${to}
      GROUP BY c."channel" ORDER BY count DESC
    `),
    prisma.$queryRaw<{ hour: number; count: number }[]>(Prisma.sql`
      SELECT EXTRACT(HOUR FROM (m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${METRICS_TIMEZONE}))::int AS hour,
             COUNT(*)::int AS count
      FROM "messages" m JOIN "conversations" c ON c.id = m."conversationId"
      WHERE m."organizationId" = ${organizationId}
        AND m."createdAt" >= ${from} AND m."createdAt" < ${to}
        ${channelSql(channel)}
      GROUP BY hour ORDER BY hour ASC
    `),
    prisma.aiUsageEvent.aggregate({
      where: { organizationId, createdAt: period },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, toolCallsCount: true },
      _avg: { latencyMs: true },
    }),
    prisma.aiUsageEvent.count({
      where: { organizationId, createdAt: period, success: true },
    }),
    prisma.aiUsageEvent.groupBy({
      by: ["model"],
      where: { organizationId, createdAt: period, success: true, model: { not: "" } },
      _count: { _all: true },
      orderBy: { _count: { model: "desc" } },
      take: 1,
    }),
    prisma.agentToolUsage.groupBy({
      by: ["tool"],
      where: { organizationId, createdAt: period },
      _count: { _all: true },
      orderBy: { _count: { tool: "desc" } },
    }),
    prisma.$queryRaw<{ name: string; count: number }[]>(Prisma.sql`
      SELECT item AS name, COUNT(*)::int AS count
      FROM "agent_tool_usage" t,
           LATERAL jsonb_array_elements_text(t."metadata"->'items') AS item
      WHERE t."organizationId" = ${organizationId}
        AND t."tool" = 'search_products'
        AND t."createdAt" >= ${from} AND t."createdAt" < ${to}
      GROUP BY item ORDER BY count DESC LIMIT 8
    `),
    prisma.$queryRaw<{ name: string; count: number }[]>(Prisma.sql`
      SELECT item AS name, COUNT(*)::int AS count
      FROM "agent_tool_usage" t,
           LATERAL jsonb_array_elements_text(t."metadata"->'items') AS item
      WHERE t."organizationId" = ${organizationId}
        AND t."tool" = 'search_services'
        AND t."createdAt" >= ${from} AND t."createdAt" < ${to}
      GROUP BY item ORDER BY count DESC LIMIT 8
    `),
    getTeamMetrics(organizationId, range, channel),
    getPlanUsage(organizationId),
    getSyncedOrders(organizationId, range),
    getIntegrationErrors(organizationId, range),
  ]);

  const statusCount = (status: string) =>
    statusGroups.find((group) => group.status === status)?._count._all ?? 0;
  const active = statusCount("OPEN");
  const pending = statusCount("PENDING");
  const closed = statusCount("CLOSED");
  const conversationsReceived = active + pending + closed;

  const messageCount = (type: string) =>
    messageGroups.find((group) => group.senderType === type)?._count._all ?? 0;
  const customerMessages = messageCount("CUSTOMER");
  const aiReplies = messageCount("AI");
  const humanReplies = messageCount("HUMAN");
  const totalReplies = aiReplies + humanReplies;
  const aiSharePct = totalReplies > 0 ? Math.round((aiReplies / totalReplies) * 100) : 0;
  const humanSharePct = totalReplies > 0 ? 100 - aiSharePct : 0;

  const timingRow = timing[0];
  const requests = usageAgg._count._all;
  const inputTokens = usageAgg._sum.inputTokens ?? 0;
  const outputTokens = usageAgg._sum.outputTokens ?? 0;
  const toolCalls = usageAgg._sum.toolCallsCount ?? 0;

  const toolUsage = toolGroups.map((group) => ({
    tool: group.tool,
    count: group._count._all,
  }));
  const knowledgeSearches =
    toolUsage.find((entry) => entry.tool === "search_knowledge")?.count ?? 0;

  const hasData =
    conversationsReceived > 0 ||
    customerMessages + aiReplies + humanReplies > 0 ||
    requests > 0 ||
    newCustomers > 0 ||
    orders.total > 0;

  return {
    totals: {
      conversationsReceived,
      active,
      pending,
      closed,
      customerMessages,
      aiReplies,
      humanReplies,
      handoffs,
      newCustomers,
      unanswered: timingRow?.unanswered ?? 0,
      aiSharePct,
      humanSharePct,
      handoffRatePct:
        conversationsReceived > 0
          ? Math.round((handoffs / conversationsReceived) * 100)
          : 0,
      avgFirstResponseSeconds: timingRow?.avg_first_response ?? null,
      avgResolutionSeconds: timingRow?.avg_resolution ?? null,
    },
    planUsage,
    orders,
    integrationErrors,
    conversationsByDay: conversationsByDayRows,
    messagesByChannel: messagesByChannelRows,
    byHour: fillHours(byHourRows),
    aiUsage: {
      requests,
      successes: usageSuccess,
      errors: requests - usageSuccess,
      inputTokens,
      outputTokens,
      avgLatencyMs: Math.round(usageAgg._avg.latencyMs ?? 0),
      toolCalls,
      activeModel: usageModel[0]?.model || getAnthropicModel() || "—",
    },
    toolUsage,
    knowledgeSearches,
    topProducts: topProductsRows,
    topServices: topServicesRows,
    team: teamData,
    hasData,
  };
}

function planMeter(used: number, limit: number): PlanUsageMeter {
  const safeLimit = limit > 0 ? limit : 0;
  const safeUsed = Math.max(0, used);
  return {
    used: safeUsed,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - safeUsed),
    percent:
      safeLimit > 0 ? Math.min(100, Math.round((safeUsed / safeLimit) * 100)) : 0,
  };
}

/**
 * Consumo del plan del MES en curso. No usa el rango del filtro a propósito:
 * los cupos se reinician por mes calendario, mostrarlos por otro período daría
 * un número que no se corresponde con el límite.
 */
async function getPlanUsage(
  organizationId: string,
  now = new Date()
): Promise<MetricsData["planUsage"]> {
  const [entitlement, usage] = await Promise.all([
    getOrganizationEntitlement(organizationId, now),
    getUsageSnapshot(organizationId, now),
  ]);
  const limits = getPlanRules(entitlement).limits;
  const resetsAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  );

  return {
    planName: BILLING_PLANS[entitlement.plan].name,
    resetsAt: new Intl.DateTimeFormat("es-AR", {
      timeZone: METRICS_TIMEZONE,
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(resetsAt),
    conversations: planMeter(usage.conversations, limits.conversationsPerMonth),
    aiResponses: planMeter(usage.aiResponses, limits.aiResponsesPerMonth),
  };
}

/** Pedidos de las tiendas conectadas con fecha de creación dentro del período. */
async function getSyncedOrders(
  organizationId: string,
  range: MetricsRange
): Promise<MetricsData["orders"]> {
  const period = { gte: range.from, lt: range.to };
  const [tiendanube, woocommerce] = await Promise.all([
    prisma.tiendanubeOrder.count({
      where: { organizationId, remoteCreatedAt: period },
    }),
    prisma.wooCommerceOrder.count({
      where: { organizationId, remoteCreatedAt: period },
    }),
  ]);

  const bySource = [
    { source: "Tiendanube", count: tiendanube },
    { source: "WooCommerce", count: woocommerce },
  ].filter((entry) => entry.count > 0);

  return { total: tiendanube + woocommerce, bySource };
}

/** Sincronizaciones fallidas del período y conexiones hoy en error. */
async function getIntegrationErrors(
  organizationId: string,
  range: MetricsRange
): Promise<MetricsData["integrationErrors"]> {
  const period = { gte: range.from, lt: range.to };
  const [
    sheetsFailed,
    tiendanubeFailed,
    wooFailed,
    sheetsConnection,
    tiendanubeConnection,
    wooConnection,
    calendarConnection,
  ] = await Promise.all([
    prisma.googleSheetsSyncRun.count({
      where: { organizationId, status: "FAILED", createdAt: period },
    }),
    prisma.tiendanubeSyncRun.count({
      where: { organizationId, status: "FAILED", createdAt: period },
    }),
    prisma.wooCommerceSyncRun.count({
      where: { organizationId, status: "FAILED", createdAt: period },
    }),
    prisma.googleSheetsConnection.findUnique({
      where: { organizationId },
      select: { status: true },
    }),
    prisma.tiendanubeConnection.findUnique({
      where: { organizationId },
      select: { status: true },
    }),
    prisma.wooCommerceConnection.findUnique({
      where: { organizationId },
      select: { status: true },
    }),
    prisma.googleCalendarConnection.findUnique({
      where: { organizationId },
      select: { status: true },
    }),
  ]);

  const items = [
    {
      source: "Google Sheets",
      failedRuns: sheetsFailed,
      connectionInError: sheetsConnection?.status === "ERROR",
    },
    {
      source: "Google Calendar",
      failedRuns: 0,
      connectionInError: calendarConnection?.status === "ERROR",
    },
    {
      source: "Tiendanube",
      failedRuns: tiendanubeFailed,
      connectionInError: tiendanubeConnection?.status === "ERROR",
    },
    {
      source: "WooCommerce",
      failedRuns: wooFailed,
      connectionInError: wooConnection?.status === "ERROR",
    },
  ].filter((entry) => entry.failedRuns > 0 || entry.connectionInError);

  return {
    total: items.reduce(
      (acc, entry) => acc + entry.failedRuns + (entry.connectionInError ? 1 : 0),
      0
    ),
    items,
  };
}

function fillHours(rows: { hour: number; count: number }[]) {
  const map = new Map(rows.map((row) => [row.hour, row.count]));
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: map.get(hour) ?? 0,
  }));
}

async function getTeamMetrics(
  organizationId: string,
  range: MetricsRange,
  channel?: MetricsChannel
): Promise<TeamMemberMetric[]> {
  const { from, to } = range;
  const period = { gte: from, lt: to };

  const [members, humanByUser, takenByUser, closedByUser, responseByUser] =
    await Promise.all([
      prisma.organizationMember.findMany({
        where: { organizationId },
        select: { userId: true, user: { select: { name: true } } },
      }),
      prisma.message.groupBy({
        by: ["senderUserId"],
        where: {
          organizationId,
          senderType: "HUMAN",
          senderUserId: { not: null },
          createdAt: period,
          ...(channel ? { conversation: { channel } } : {}),
        },
        _count: { _all: true },
      }),
      prisma.conversation.groupBy({
        by: ["assignedUserId"],
        where: {
          organizationId,
          assignedUserId: { not: null },
          humanTakeoverAt: period,
          ...channelFilter(channel),
        },
        _count: { _all: true },
      }),
      prisma.conversation.groupBy({
        by: ["assignedUserId"],
        where: {
          organizationId,
          assignedUserId: { not: null },
          closedAt: period,
          ...channelFilter(channel),
        },
        _count: { _all: true },
      }),
      prisma.$queryRaw<{ user_id: string; avg_seconds: number | null }[]>(Prisma.sql`
        SELECT m."senderUserId" AS user_id,
               AVG(EXTRACT(EPOCH FROM (m."createdAt" - prev.t)))::float8 AS avg_seconds
        FROM "messages" m
        JOIN "conversations" c ON c.id = m."conversationId"
        JOIN LATERAL (
          SELECT MAX(p."createdAt") AS t
          FROM "messages" p
          WHERE p."conversationId" = m."conversationId"
            AND p."senderType" = 'CUSTOMER'
            AND p."createdAt" < m."createdAt"
        ) prev ON true
        WHERE m."organizationId" = ${organizationId}
          AND m."senderType" = 'HUMAN'
          AND m."senderUserId" IS NOT NULL
          AND m."createdAt" >= ${from} AND m."createdAt" < ${to}
          AND prev.t IS NOT NULL
          ${channelSql(channel)}
        GROUP BY m."senderUserId"
      `),
    ]);

  const humanMap = new Map(
    humanByUser.map((row) => [row.senderUserId, row._count._all])
  );
  const takenMap = new Map(
    takenByUser.map((row) => [row.assignedUserId, row._count._all])
  );
  const closedMap = new Map(
    closedByUser.map((row) => [row.assignedUserId, row._count._all])
  );
  const responseMap = new Map(
    responseByUser.map((row) => [row.user_id, row.avg_seconds])
  );

  return members
    .map((member) => ({
      userId: member.userId,
      name: member.user.name,
      taken: takenMap.get(member.userId) ?? 0,
      humanMessages: humanMap.get(member.userId) ?? 0,
      closed: closedMap.get(member.userId) ?? 0,
      avgResponseSeconds: responseMap.get(member.userId) ?? null,
    }))
    .filter(
      (member) =>
        member.taken > 0 || member.humanMessages > 0 || member.closed > 0
    )
    .sort((a, b) => b.humanMessages - a.humanMessages);
}
