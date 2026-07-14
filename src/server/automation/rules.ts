import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_FOLLOW_UP_CONFIG,
  DEFAULT_HANDOFF_CONFIG,
  parseAutomationRuleConfig,
  type AutomationRuleTypeValue,
  type AutomationRuleUpdate,
  type FollowUpRuleConfig,
  type HandoffRuleConfig,
} from "@/lib/validations/automation-rules";
import { sanitizeAutomationMessage } from "@/server/automation/sanitization";
import { cancelPendingFollowUpsTx } from "@/server/automation/follow-up";

export type AutomationRuleVisualState =
  | "ACTIVE"
  | "PAUSED"
  | "INCOMPLETE"
  | "ERROR"
  | "WORKING";

export type AutomationRuleView = {
  id: string | null;
  updatedAt: string | null;
  version: number | null;
  type: AutomationRuleTypeValue;
  enabled: boolean;
  config: HandoffRuleConfig | FollowUpRuleConfig;
  state: AutomationRuleVisualState;
  lastExecutionAt: string | null;
  lastError: string | null;
};

type StoredRule = {
  id: string;
  updatedAt: Date;
  version: number;
  type: AutomationRuleTypeValue;
  enabled: boolean;
  config: unknown;
  lastExecution: {
    status: string;
    executedAt: Date;
    lastError: string | null;
  } | null;
  lastHistoricalError: string | null;
};

export class AutomationRuleConflictError extends Error {
  override name = "AutomationRuleConflictError";
}

function defaultConfig(type: AutomationRuleTypeValue) {
  return type === "HANDOFF_ALERT"
    ? DEFAULT_HANDOFF_CONFIG
    : DEFAULT_FOLLOW_UP_CONFIG;
}

export function resolveAutomationRuleState(input: {
  enabled: boolean;
  configValid: boolean;
  lastStatus?: string | null;
  lastError?: string | null;
}): AutomationRuleVisualState {
  if (!input.configValid) return "INCOMPLETE";
  if (!input.enabled) return "PAUSED";
  if (
    input.lastError ||
    input.lastStatus === "FAILED" ||
    input.lastStatus === "DEAD_LETTER"
  ) {
    return "ERROR";
  }
  if (input.lastStatus === "SUCCEEDED") return "WORKING";
  return "ACTIVE";
}

function toView(type: AutomationRuleTypeValue, stored?: StoredRule): AutomationRuleView {
  if (!stored) {
    return {
      id: null,
      updatedAt: null,
      version: null,
      type,
      enabled: false,
      config: defaultConfig(type),
      state: "PAUSED",
      lastExecutionAt: null,
      lastError: null,
    };
  }

  let config: HandoffRuleConfig | FollowUpRuleConfig = defaultConfig(type);
  let configValid = true;
  try {
    config = parseAutomationRuleConfig(type, stored.config);
  } catch {
    configValid = false;
  }
  const lastExecutionAt = stored.lastExecution?.executedAt ?? null;
  const lastError = sanitizeAutomationMessage(stored.lastHistoricalError);
  return {
    id: stored.id,
    updatedAt: stored.updatedAt.toISOString(),
    version: stored.version,
    type,
    enabled: stored.enabled,
    config,
    state: resolveAutomationRuleState({
      enabled: stored.enabled,
      configValid,
      lastStatus: stored.lastExecution?.status,
      lastError: sanitizeAutomationMessage(stored.lastExecution?.lastError),
    }),
    lastExecutionAt: lastExecutionAt?.toISOString() ?? null,
    lastError,
  };
}

export async function getAutomationRules(
  organizationId: string
): Promise<AutomationRuleView[]> {
  const stored = await prisma.organizationAutomationRule.findMany({
    where: { organizationId },
    select: {
      id: true,
      updatedAt: true,
      version: true,
      type: true,
      enabled: true,
      config: true,
    },
  });
  const enriched: StoredRule[] = [];
  for (const rule of stored) {
    const latestRun = await prisma.automationRun.findFirst({
      where: {
        organizationId,
        automationEvent: { automationRuleId: rule.id },
      },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      select: {
        startedAt: true,
        finishedAt: true,
        errorCode: true,
        errorMessage: true,
        automationEvent: {
          select: { status: true, lastError: true },
        },
      },
    });
    const latestFailedRun = await prisma.automationRun.findFirst({
      where: {
        organizationId,
        status: "FAILED",
        automationEvent: { automationRuleId: rule.id },
      },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      select: {
        createdAt: true,
        finishedAt: true,
        errorCode: true,
        errorMessage: true,
      },
    });
    const latestErrorEvent = await prisma.automationEvent.findFirst({
      where: {
        organizationId,
        automationRuleId: rule.id,
        OR: [
          { lastError: { not: null } },
          { status: { in: ["FAILED", "DEAD_LETTER"] } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        updatedAt: true,
        lastError: true,
      },
    });
    const historicalErrors = [
      latestFailedRun
        ? {
            at: latestFailedRun.finishedAt ?? latestFailedRun.createdAt,
            value: latestFailedRun.errorMessage ?? latestFailedRun.errorCode,
          }
        : null,
      latestErrorEvent?.lastError
        ? { at: latestErrorEvent.updatedAt, value: latestErrorEvent.lastError }
        : null,
    ]
      .filter(
        (candidate): candidate is { at: Date; value: string } =>
          Boolean(candidate?.value)
      )
      .sort((left, right) => right.at.getTime() - left.at.getTime());
    enriched.push({
      ...rule,
      lastExecution: latestRun
        ? {
            status: latestRun.automationEvent.status,
            executedAt: latestRun.finishedAt ?? latestRun.startedAt,
            lastError:
              latestRun.automationEvent.lastError ??
              latestRun.errorMessage ??
              latestRun.errorCode,
          }
        : null,
      lastHistoricalError: historicalErrors[0]?.value ?? null,
    });
  }
  const byType = new Map(enriched.map((rule) => [rule.type, rule]));
  return (["HANDOFF_ALERT", "FOLLOW_UP"] as const).map((type) =>
    toView(type, byType.get(type))
  );
}

function safeAuditDetails(input: AutomationRuleUpdate) {
  if (input.type === "HANDOFF_ALERT") {
    return {
      type: input.type,
      enabled: input.enabled,
      recipients: input.config.recipients,
    };
  }
  return {
    type: input.type,
    enabled: input.enabled,
    delayHours: input.config.delayHours,
    maxFollowUps: input.config.maxFollowUps,
    startTime: input.config.startTime,
    endTime: input.config.endTime,
    enabledDays: input.config.enabledDays,
    timeZone: input.config.timeZone,
  };
}

export async function updateAutomationRule(input: {
  organizationId: string;
  userId: string;
  rule: AutomationRuleUpdate;
}): Promise<AutomationRuleView> {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.organizationAutomationRule.findUnique({
        where: {
          organizationId_type: {
            organizationId: input.organizationId,
            type: input.rule.type,
          },
        },
        select: { id: true, version: true },
      });

      let savedId: string;
      if (existing) {
        const expected = input.rule.expectedVersion;
        if (!expected || existing.version !== expected) {
          throw new AutomationRuleConflictError();
        }
        const updated = await tx.organizationAutomationRule.updateMany({
          where: {
            id: existing.id,
            organizationId: input.organizationId,
            version: expected,
          },
          data: {
            enabled: input.rule.enabled,
            config: input.rule.config as Prisma.InputJsonValue,
            updatedById: input.userId,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new AutomationRuleConflictError();
        savedId = existing.id;
      } else {
        if (input.rule.expectedVersion !== null) {
          throw new AutomationRuleConflictError();
        }
        const created = await tx.organizationAutomationRule.create({
          data: {
            organizationId: input.organizationId,
            type: input.rule.type,
            enabled: input.rule.enabled,
            config: input.rule.config as Prisma.InputJsonValue,
            createdById: input.userId,
            updatedById: input.userId,
          },
          select: { id: true },
        });
        savedId = created.id;
      }

      if (input.rule.type === "FOLLOW_UP" && !input.rule.enabled) {
        await cancelPendingFollowUpsTx(tx, {
          organizationId: input.organizationId,
          reason: "rule_disabled",
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId,
          action: existing
            ? "automation.rule_updated"
            : "automation.rule_created",
          entityType: "automation_rule",
          entityId: savedId,
          details: safeAuditDetails(input.rule),
        },
      });
    });
  } catch (error) {
    if (
      error instanceof AutomationRuleConflictError ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002")
    ) {
      throw new AutomationRuleConflictError();
    }
    throw error;
  }

  const rules = await getAutomationRules(input.organizationId);
  return rules.find((rule) => rule.type === input.rule.type)!;
}
