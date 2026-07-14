import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getAnthropicModel } from "@/server/agent/config";
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
];

export type MetricsChannel = "test" | "whatsapp";

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
    avgFirstResponseSeconds: number | null;
    avgResolutionSeconds: number | null;
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
    newCustomers > 0;

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
      avgFirstResponseSeconds: timingRow?.avg_first_response ?? null,
      avgResolutionSeconds: timingRow?.avg_resolution ?? null,
    },
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
