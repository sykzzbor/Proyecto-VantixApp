import { Prisma } from "@/generated/prisma/client";
import type {
  AutomationEventStatus,
  AutomationRunStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type {
  AutomationEventQuery,
  AutomationPeriod,
  AutomationRunQuery,
} from "@/lib/validations/automation";
import {
  getAutomationProviderMode,
  getN8nConfigurationState,
  type N8nMissingCategory,
} from "@/server/automation/config";
import {
  maskIdempotencyKey,
  safeExternalExecutionId,
  sanitizeAutomationMessage,
  sanitizeAutomationValue,
  shortAutomationId,
} from "@/server/automation/sanitization";

const EVENT_STATUSES: AutomationEventStatus[] = [
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "DEAD_LETTER",
  "CANCELLED",
];

export function resolveAutomationRange(
  period: AutomationPeriod,
  now = new Date()
) {
  const durationMs =
    period === "24h" ? 24 * 60 * 60 * 1000 : period === "7d" ? 7 * 86_400_000 : 30 * 86_400_000;
  return { from: new Date(now.getTime() - durationMs), to: now, period };
}

export type AutomationOverview = {
  total: number;
  pending: number;
  processing: number;
  succeeded: number;
  failed: number;
  deadLetter: number;
  cancelled: number;
  successRate: number;
  averageDurationMs: number | null;
  handoffRequested: number;
  followUpsScheduled: number;
  followUpsSent: number;
  followUpsCancelled: number;
  followUpsFailed: number;
};

export function calculateAutomationOverview(
  statusCounts: Partial<Record<AutomationEventStatus, number>>,
  averageDurationMs: number | null,
  operational: Partial<
    Pick<
      AutomationOverview,
      | "handoffRequested"
      | "followUpsScheduled"
      | "followUpsSent"
      | "followUpsCancelled"
      | "followUpsFailed"
    >
  > = {}
): AutomationOverview {
  const count = (status: AutomationEventStatus) => statusCounts[status] ?? 0;
  const terminal = count("SUCCEEDED") + count("FAILED") + count("DEAD_LETTER");
  return {
    total: EVENT_STATUSES.reduce((sum, status) => sum + count(status), 0),
    pending: count("PENDING"),
    processing: count("PROCESSING"),
    succeeded: count("SUCCEEDED"),
    failed: count("FAILED"),
    deadLetter: count("DEAD_LETTER"),
    cancelled: count("CANCELLED"),
    successRate: terminal === 0 ? 0 : Math.round((count("SUCCEEDED") / terminal) * 1000) / 10,
    averageDurationMs:
      averageDurationMs === null ? null : Math.round(averageDurationMs),
    handoffRequested: operational.handoffRequested ?? 0,
    followUpsScheduled: operational.followUpsScheduled ?? 0,
    followUpsSent: operational.followUpsSent ?? 0,
    followUpsCancelled: operational.followUpsCancelled ?? 0,
    followUpsFailed: operational.followUpsFailed ?? 0,
  };
}

export async function getAutomationOverview(
  organizationId: string,
  period: AutomationPeriod
): Promise<AutomationOverview> {
  const range = resolveAutomationRange(period);
  const where = { organizationId, createdAt: { gte: range.from, lte: range.to } };
  const [groups, duration, operationalGroups, followUpsSent] = await Promise.all([
    prisma.automationEvent.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
    prisma.automationRun.aggregate({
      where: {
        organizationId,
        createdAt: { gte: range.from, lte: range.to },
        durationMs: { not: null },
      },
      _avg: { durationMs: true },
    }),
    prisma.automationEvent.groupBy({
      by: ["type", "status"],
      where: {
        ...where,
        type: {
          in: ["conversation.handoff_requested", "conversation.followup_due"],
        },
      },
      _count: { _all: true },
    }),
    prisma.automationEvent.count({
      where: {
        ...where,
        type: "conversation.followup_due",
        actionMessage: {
          deliveryStatus: { in: ["SENT", "DELIVERED", "READ"] },
        },
      },
    }),
  ]);
  const counts: Partial<Record<AutomationEventStatus, number>> = {};
  for (const group of groups) counts[group.status] = group._count._all;
  const countOperational = (type: string, statuses?: AutomationEventStatus[]) =>
    operationalGroups
      .filter(
        (group) =>
          group.type === type && (!statuses || statuses.includes(group.status))
      )
      .reduce((sum, group) => sum + group._count._all, 0);
  return calculateAutomationOverview(counts, duration._avg.durationMs, {
    handoffRequested: countOperational("conversation.handoff_requested"),
    followUpsScheduled: countOperational("conversation.followup_due"),
    followUpsSent,
    followUpsCancelled: countOperational("conversation.followup_due", [
      "CANCELLED",
    ]),
    followUpsFailed: countOperational("conversation.followup_due", [
      "FAILED",
      "DEAD_LETTER",
    ]),
  });
}

export type AutomationInfrastructureStatus = {
  provider: "mock" | "n8n";
  state: "operational" | "incomplete" | "error";
  mockMode: boolean;
  dispatcherConfigured: boolean;
  callbackConfigured: boolean;
  endpointConfigured: boolean;
  outboundSignatureConfigured: boolean;
  providerConfigured: boolean;
  missingCategories: N8nMissingCategory[];
  connectionEnabled: boolean;
  connectionStatus: "CONNECTED" | "DISCONNECTED" | "ERROR" | "NOT_CREATED";
  lastProcessedAt: string | null;
  lastEventSentAt: string | null;
  lastCallbackAt: string | null;
  lastSuccessfulRunAt: string | null;
  lastError: string | null;
};

export async function getAutomationInfrastructureStatus(
  organizationId: string
): Promise<AutomationInfrastructureStatus> {
  const provider = getAutomationProviderMode();
  const configuration = getN8nConfigurationState();
  const dispatcherConfigured = configuration.dispatcher;
  const callbackConfigured = configuration.callbackSignature;
  const [connection, lastProcessed, lastSuccess, lastFailure] = await Promise.all([
    prisma.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: "n8n" } },
      select: {
        status: true,
        enabled: true,
        lastError: true,
        lastEventAt: true,
        lastCallbackAt: true,
      },
    }),
    prisma.automationEvent.findFirst({
      where: { organizationId, processedAt: { not: null } },
      orderBy: { processedAt: "desc" },
      select: { processedAt: true },
    }),
    prisma.automationRun.findFirst({
      where: {
        organizationId,
        status: "SUCCEEDED",
        ...(provider === "n8n" ? { provider: "n8n" } : {}),
      },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    prisma.automationEvent.findFirst({
      where: { organizationId, status: { in: ["FAILED", "DEAD_LETTER"] } },
      orderBy: { updatedAt: "desc" },
      select: { lastError: true },
    }),
  ]);

  const providerConfigured = provider === "mock" || configuration.complete;
  const connectionStatus = connection?.status ?? "NOT_CREATED";
  const state =
    provider === "mock"
      ? "operational"
      : !providerConfigured
        ? "incomplete"
        : connectionStatus === "ERROR"
          ? "error"
          : "operational";

  return {
    provider,
    state,
    mockMode: provider === "mock",
    dispatcherConfigured,
    callbackConfigured,
    endpointConfigured: configuration.endpoint,
    outboundSignatureConfigured: configuration.outboundSignature,
    providerConfigured,
    missingCategories: provider === "mock" ? [] : configuration.missing,
    connectionEnabled: connection?.enabled ?? false,
    connectionStatus,
    lastProcessedAt: lastProcessed?.processedAt?.toISOString() ?? null,
    lastEventSentAt: connection?.lastEventAt?.toISOString() ?? null,
    lastCallbackAt: connection?.lastCallbackAt?.toISOString() ?? null,
    lastSuccessfulRunAt: lastSuccess?.finishedAt?.toISOString() ?? null,
    lastError: sanitizeAutomationMessage(
      connection?.lastError ?? lastFailure?.lastError ?? null
    ),
  };
}

export function buildAutomationEventWhere(
  organizationId: string,
  query: AutomationEventQuery,
  now = new Date()
): Prisma.AutomationEventWhereInput {
  const range = resolveAutomationRange(query.period, now);
  return {
    organizationId,
    createdAt: { gte: range.from, lte: range.to },
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.q ? { id: { contains: query.q, mode: "insensitive" } } : {}),
  };
}

export type AutomationEventRow = {
  id: string;
  shortId: string;
  type: string;
  status: AutomationEventStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string | null;
  latestRun: {
    provider: string;
    status: AutomationRunStatus;
    durationMs: number | null;
  } | null;
};

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function resolveAutomationPagination(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export async function listAutomationEvents(
  organizationId: string,
  query: AutomationEventQuery
): Promise<Paginated<AutomationEventRow>> {
  const where = buildAutomationEventWhere(organizationId, query);
  const pagination = resolveAutomationPagination(query.page, query.pageSize);
  const [total, rows] = await Promise.all([
    prisma.automationEvent.count({ where }),
    prisma.automationEvent.findMany({
      where,
      orderBy: { createdAt: query.order },
      ...pagination,
      select: {
        id: true,
        type: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        createdAt: true,
        updatedAt: true,
        nextAttemptAt: true,
        runs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { provider: true, status: true, durationMs: true },
        },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      shortId: shortAutomationId(row.id),
      type: row.type,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
      latestRun: row.runs[0] ?? null,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export type AutomationRunRow = {
  id: string;
  shortId: string;
  eventId: string;
  eventShortId: string;
  eventType: string;
  provider: string;
  status: AutomationRunStatus;
  attempt: number;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  externalExecutionId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

function buildAutomationRunWhere(
  organizationId: string,
  query: AutomationRunQuery,
  now = new Date()
): Prisma.AutomationRunWhereInput {
  const range = resolveAutomationRange(query.period, now);
  return {
    organizationId,
    createdAt: { gte: range.from, lte: range.to },
    ...(query.status ? { status: query.status } : {}),
    ...(query.provider ? { provider: query.provider } : {}),
    ...(query.type ? { automationEvent: { type: query.type } } : {}),
  };
}

export async function listAutomationRuns(
  organizationId: string,
  query: AutomationRunQuery
): Promise<Paginated<AutomationRunRow>> {
  const where = buildAutomationRunWhere(organizationId, query);
  const pagination = resolveAutomationPagination(query.page, query.pageSize);
  const [total, rows] = await Promise.all([
    prisma.automationRun.count({ where }),
    prisma.automationRun.findMany({
      where,
      orderBy: { createdAt: query.order },
      ...pagination,
      select: {
        id: true,
        automationEventId: true,
        provider: true,
        status: true,
        attempt: true,
        durationMs: true,
        startedAt: true,
        finishedAt: true,
        externalExecutionId: true,
        errorCode: true,
        errorMessage: true,
        automationEvent: { select: { type: true } },
      },
    }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      shortId: shortAutomationId(row.id),
      eventId: row.automationEventId,
      eventShortId: shortAutomationId(row.automationEventId),
      eventType: row.automationEvent.type,
      provider: row.provider,
      status: row.status,
      attempt: row.attempt,
      durationMs: row.durationMs,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      externalExecutionId: safeExternalExecutionId(row.externalExecutionId),
      errorCode: row.errorCode,
      errorMessage: sanitizeAutomationMessage(row.errorMessage),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export type AutomationEventDetail = {
  id: string;
  shortId: string;
  type: string;
  status: AutomationEventStatus;
  schemaVersion: number;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string | null;
  processedAt: string | null;
  lastError: string | null;
  conversationId: string | null;
  sourceMessageId: string | null;
  ruleType: "HANDOFF_ALERT" | "FOLLOW_UP" | null;
  cancellationReason: string | null;
  followUpNumber: number | null;
  schedulingReason: string | null;
  actionDeliveryStatus: string | null;
  payload?: unknown;
  runs: AutomationRunRow[];
};

export async function getAutomationEventDetail(
  organizationId: string,
  id: string,
  includePayload: boolean
): Promise<AutomationEventDetail | null> {
  const event = await prisma.automationEvent.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      type: true,
      payload: true,
      status: true,
      schemaVersion: true,
      attempts: true,
      maxAttempts: true,
      idempotencyKey: true,
      createdAt: true,
      updatedAt: true,
      nextAttemptAt: true,
      processedAt: true,
      lastError: true,
      conversationId: true,
      sourceMessageId: true,
      cancellationReason: true,
      followUpNumber: true,
      automationRule: { select: { type: true } },
      actionMessage: { select: { deliveryStatus: true } },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          automationEventId: true,
          provider: true,
          status: true,
          attempt: true,
          durationMs: true,
          startedAt: true,
          finishedAt: true,
          externalExecutionId: true,
          errorCode: true,
          errorMessage: true,
        },
      },
    },
  });
  if (!event) return null;
  const rawPayload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : null;
  return {
    id: event.id,
    shortId: shortAutomationId(event.id),
    type: event.type,
    status: event.status,
    schemaVersion: event.schemaVersion,
    attempts: event.attempts,
    maxAttempts: event.maxAttempts,
    idempotencyKey: maskIdempotencyKey(event.idempotencyKey),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    nextAttemptAt: event.nextAttemptAt?.toISOString() ?? null,
    processedAt: event.processedAt?.toISOString() ?? null,
    lastError: sanitizeAutomationMessage(event.lastError),
    conversationId: event.conversationId,
    sourceMessageId: event.sourceMessageId
      ? shortAutomationId(event.sourceMessageId)
      : null,
    ruleType: event.automationRule?.type ?? null,
    cancellationReason: sanitizeAutomationMessage(
      event.cancellationReason,
      120
    ),
    followUpNumber: event.followUpNumber,
    schedulingReason:
      typeof rawPayload?.reason === "string"
        ? sanitizeAutomationMessage(rawPayload.reason, 120)
        : null,
    actionDeliveryStatus: event.actionMessage?.deliveryStatus ?? null,
    ...(includePayload ? { payload: sanitizeAutomationValue(event.payload) } : {}),
    runs: event.runs.map((run) => ({
      id: run.id,
      shortId: shortAutomationId(run.id),
      eventId: run.automationEventId,
      eventShortId: shortAutomationId(run.automationEventId),
      eventType: event.type,
      provider: run.provider,
      status: run.status,
      attempt: run.attempt,
      durationMs: run.durationMs,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      externalExecutionId: safeExternalExecutionId(run.externalExecutionId),
      errorCode: run.errorCode,
      errorMessage: sanitizeAutomationMessage(run.errorMessage),
    })),
  };
}

export async function listAutomationEventTypes(
  organizationId: string
): Promise<string[]> {
  const rows = await prisma.automationEvent.findMany({
    where: { organizationId },
    select: { type: true },
    distinct: ["type"],
    orderBy: { type: "asc" },
  });
  return rows.map((row) => row.type);
}

export async function listAutomationProviders(
  organizationId: string
): Promise<string[]> {
  const rows = await prisma.automationRun.findMany({
    where: { organizationId },
    select: { provider: true },
    distinct: ["provider"],
    orderBy: { provider: "asc" },
  });
  return rows.map((row) => row.provider);
}
