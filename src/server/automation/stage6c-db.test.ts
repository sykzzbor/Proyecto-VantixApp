import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadEnvConfig } from "@next/env";
import {
  DEFAULT_FOLLOW_UP_CONFIG,
  DEFAULT_HANDOFF_CONFIG,
} from "@/lib/validations/automation-rules";

loadEnvConfig(process.cwd());

function isExplicitSafeLocalDatabase() {
  if (process.env.RUN_STAGE6C_DB_TESTS !== "1") return false;
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) return false;
  const value = process.env.DATABASE_URL?.trim();
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

test(
  "follow-up DB: respuesta, takeover y carrera cancelación-envío fallan cerrado",
  { skip: !isExplicitSafeLocalDatabase() && "requiere opt-in y PostgreSQL local" },
  async () => {
    const [{ prisma }, followUp, action, conversations, crypto, queue] = await Promise.all([
      import("@/lib/prisma"),
      import("@/server/automation/follow-up"),
      import("@/server/automation/follow-up-action"),
      import("@/server/conversations"),
      import("@/server/whatsapp/crypto"),
      import("@/server/automation/queue"),
    ]);
    const suffix = randomUUID();
    const organization = await prisma.organization.create({
      data: {
        name: "Etapa 6C DB test",
        slug: `stage6c-db-${suffix}`,
      },
      select: { id: true },
    });
    const originalFetch = globalThis.fetch;
    const originalEncryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
    const originalGraphApiVersion = process.env.META_GRAPH_API_VERSION;
    process.env.CREDENTIALS_ENCRYPTION_KEY = "00".repeat(32);
    process.env.META_GRAPH_API_VERSION = "v23.0";

    try {
      const ruleConfig = {
        ...DEFAULT_FOLLOW_UP_CONFIG,
        delayHours: 2 as const,
        maxFollowUps: 3,
        startTime: "00:00",
        endTime: "23:59",
        enabledDays: [1, 2, 3, 4, 5, 6, 7],
        timeZone: "UTC",
      };
      const rule = await prisma.organizationAutomationRule.create({
        data: {
          organizationId: organization.id,
          type: "FOLLOW_UP",
          enabled: true,
          config: ruleConfig,
        },
        select: { id: true },
      });
      const customer = await prisma.customer.create({
        data: {
          organizationId: organization.id,
          name: "Cliente de prueba",
          phone: "5493510000000",
        },
        select: { id: true },
      });
      const integration = await prisma.whatsappIntegration.create({
        data: {
          organizationId: organization.id,
          wabaId: `waba-${suffix}`,
          phoneNumberId: "123456789012345",
          displayPhoneNumber: "+54 9 351 000 0000",
          verifiedName: "Etapa 6C",
          encryptedAccessToken: crypto.encryptAccessToken(
            "test-only-access-token-1234567890"
          ),
          status: "CONNECTED",
        },
        select: { id: true },
      });

      const conversation = await prisma.conversation.create({
        data: {
          organizationId: organization.id,
          customerId: customer.id,
          whatsappIntegrationId: integration.id,
          channel: "whatsapp",
          status: "OPEN",
          handlingMode: "AI",
        },
        select: { id: true },
      });
      const sourceInstant = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const source = await prisma.message.create({
        data: {
          organizationId: organization.id,
          conversationId: conversation.id,
          senderType: "AI",
          content: "Mensaje saliente",
          deliveryStatus: "SENT",
          createdAt: sourceInstant,
          ingestedAt: sourceInstant,
        },
        select: { id: true, ingestedAt: true },
      });
      await prisma.message.create({
        data: {
          organizationId: organization.id,
          conversationId: conversation.id,
          senderType: "CUSTOMER",
          content: "Respuesta posterior con timestamp externo atrasado",
          createdAt: new Date(sourceInstant.getTime() - 1_000),
          ingestedAt: source.ingestedAt,
        },
      });
      assert.deepEqual(
        await followUp.scheduleFollowUpAfterOutbound({
          organizationId: organization.id,
          conversationId: conversation.id,
          sourceMessageId: source.id,
        }),
        { scheduled: false, reason: "customer_replied" }
      );

      const takeoverAt = new Date();
      const takeoverConversation = await prisma.conversation.create({
        data: {
          organizationId: organization.id,
          customerId: customer.id,
          whatsappIntegrationId: integration.id,
          channel: "whatsapp",
          status: "OPEN",
          handlingMode: "HUMAN",
          humanTakeoverAt: takeoverAt,
        },
        select: { id: true },
      });
      const aiBeforeTakeover = await prisma.message.create({
        data: {
          organizationId: organization.id,
          conversationId: takeoverConversation.id,
          senderType: "AI",
          content: "IA antes del takeover",
          deliveryStatus: "SENT",
          createdAt: sourceInstant,
          ingestedAt: new Date(takeoverAt.getTime() - 1_000),
        },
        select: { id: true },
      });
      assert.deepEqual(
        await followUp.scheduleFollowUpAfterOutbound({
          organizationId: organization.id,
          conversationId: takeoverConversation.id,
          sourceMessageId: aiBeforeTakeover.id,
        }),
        { scheduled: false, reason: "human_takeover" }
      );

      const humanSource = await prisma.message.create({
        data: {
          organizationId: organization.id,
          conversationId: takeoverConversation.id,
          senderType: "HUMAN",
          content: "Respuesta del agente después del takeover",
          deliveryStatus: "SENT",
          createdAt: sourceInstant,
          ingestedAt: new Date(takeoverAt.getTime() + 1_000),
        },
        select: { id: true },
      });
      const scheduled = await followUp.scheduleFollowUpAfterOutbound({
        organizationId: organization.id,
        conversationId: takeoverConversation.id,
        sourceMessageId: humanSource.id,
      });
      assert.equal(scheduled.scheduled, true);
      if (!scheduled.scheduled) assert.fail("el mensaje HUMAN debía programar");

      const lockedAt = new Date();
      await prisma.automationEvent.update({
        where: { id: scheduled.eventId },
        data: {
          status: "PROCESSING",
          attempts: 1,
          lockedAt,
          nextAttemptAt: null,
        },
      });
      const run = await prisma.automationRun.create({
        data: {
          organizationId: organization.id,
          automationEventId: scheduled.eventId,
          provider: "n8n",
          status: "STARTED",
          attempt: 1,
          startedAt: lockedAt,
        },
        select: { id: true },
      });

      // Orden 1: la respuesta confirma después de reservar el Message PENDING
      // pero antes del segundo claim. La acción debe cancelar sin tocar Meta.
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        return new Response(
          JSON.stringify({ messages: [{ id: "stage6c-meta-test" }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }) as typeof fetch;
      const result = await action.executeFollowUpAction(
        {
          eventId: scheduled.eventId,
          runId: run.id,
          organizationId: organization.id,
          conversationId: takeoverConversation.id,
        },
        {
          afterReservation: async () => {
            await conversations.saveMessage({
              organizationId: organization.id,
              conversationId: takeoverConversation.id,
              senderType: "CUSTOMER",
              content: "Respuesta entre reserva y claim",
            });
          },
        }
      );

      assert.equal(result.ok, true);
      assert.equal(result.ok && result.state, "cancelled");
      assert.equal(fetchCalls, 0);
      const event = await prisma.automationEvent.findFirst({
        where: { id: scheduled.eventId, organizationId: organization.id },
        select: {
          status: true,
          cancellationReason: true,
          actionClaimedAt: true,
        },
      });
      assert.deepEqual(event, {
        status: "CANCELLED",
        cancellationReason: "customer_replied",
        actionClaimedAt: null,
      });

      // Orden 2: el claim confirma primero. La respuesta posterior no puede
      // retirar un side effect ya comprometido, pero jamás produce duplicados.
      const claimedFirstConversation = await prisma.conversation.create({
        data: {
          organizationId: organization.id,
          customerId: customer.id,
          whatsappIntegrationId: integration.id,
          channel: "whatsapp",
          status: "OPEN",
          handlingMode: "HUMAN",
          humanTakeoverAt: takeoverAt,
        },
        select: { id: true },
      });
      const claimedFirstSource = await prisma.message.create({
        data: {
          organizationId: organization.id,
          conversationId: claimedFirstConversation.id,
          senderType: "HUMAN",
          content: "Respuesta del agente para el segundo orden",
          deliveryStatus: "SENT",
          createdAt: sourceInstant,
          ingestedAt: new Date(takeoverAt.getTime() + 2_000),
        },
        select: { id: true },
      });
      const claimedFirstScheduled = await followUp.scheduleFollowUpAfterOutbound({
        organizationId: organization.id,
        conversationId: claimedFirstConversation.id,
        sourceMessageId: claimedFirstSource.id,
      });
      assert.equal(claimedFirstScheduled.scheduled, true);
      if (!claimedFirstScheduled.scheduled) {
        assert.fail("el segundo seguimiento debía programarse");
      }
      const claimedFirstLockedAt = new Date();
      await prisma.automationEvent.update({
        where: { id: claimedFirstScheduled.eventId },
        data: {
          status: "PROCESSING",
          attempts: 1,
          lockedAt: claimedFirstLockedAt,
          nextAttemptAt: null,
        },
      });
      const claimedFirstRun = await prisma.automationRun.create({
        data: {
          organizationId: organization.id,
          automationEventId: claimedFirstScheduled.eventId,
          provider: "n8n",
          status: "STARTED",
          attempt: 1,
          startedAt: claimedFirstLockedAt,
        },
        select: { id: true },
      });
      const claimedFirstResult = await action.executeFollowUpAction(
        {
          eventId: claimedFirstScheduled.eventId,
          runId: claimedFirstRun.id,
          organizationId: organization.id,
          conversationId: claimedFirstConversation.id,
        },
        {
          afterDeliveryClaim: async () => {
            await conversations.saveMessage({
              organizationId: organization.id,
              conversationId: claimedFirstConversation.id,
              senderType: "CUSTOMER",
              content: "Respuesta posterior al claim",
            });
          },
        }
      );
      assert.equal(
        fetchCalls,
        1,
        claimedFirstResult.ok ? undefined : claimedFirstResult.code
      );
      assert.equal(
        claimedFirstResult.ok,
        true,
        claimedFirstResult.ok ? undefined : claimedFirstResult.code
      );
      assert.equal(claimedFirstResult.ok && claimedFirstResult.state, "sent");
      const claimedFirstEvent = await prisma.automationEvent.findFirst({
        where: {
          id: claimedFirstScheduled.eventId,
          organizationId: organization.id,
        },
        select: {
          status: true,
          cancellationReason: true,
          actionClaimedAt: true,
          actionMessage: { select: { deliveryStatus: true } },
        },
      });
      assert.equal(claimedFirstEvent?.status, "PROCESSING");
      assert.equal(claimedFirstEvent?.cancellationReason, null);
      assert.equal(claimedFirstEvent?.actionClaimedAt instanceof Date, true);
      assert.equal(claimedFirstEvent?.actionMessage?.deliveryStatus, "SENT");
      const duplicateResult = await action.executeFollowUpAction({
        eventId: claimedFirstScheduled.eventId,
        runId: claimedFirstRun.id,
        organizationId: organization.id,
        conversationId: claimedFirstConversation.id,
      });
      assert.equal(duplicateResult.ok, true);
      assert.equal(
        duplicateResult.ok && duplicateResult.state,
        "already_sent"
      );
      assert.equal(fetchCalls, 1);

      const reclaimConversation = await prisma.conversation.create({
        data: {
          organizationId: organization.id,
          customerId: customer.id,
          whatsappIntegrationId: integration.id,
          channel: "whatsapp",
          status: "OPEN",
          handlingMode: "HUMAN",
        },
        select: { id: true },
      });
      const reclaimSource = await prisma.message.create({
        data: {
          organizationId: organization.id,
          conversationId: reclaimConversation.id,
          senderType: "HUMAN",
          content: "Origen para reconciliar cancelación stale",
          deliveryStatus: "SENT",
        },
        select: { id: true },
      });
      const staleLockedAt = new Date(Date.now() - 10 * 60 * 1000);
      const staleActionMessage = await prisma.message.create({
        data: {
          organizationId: organization.id,
          conversationId: reclaimConversation.id,
          senderType: "AI",
          content: "Seguimiento reservado que debe cancelarse",
          deliveryStatus: "PENDING",
        },
        select: { id: true },
      });
      const staleCancelled = await prisma.automationEvent.create({
        data: {
          organizationId: organization.id,
          automationRuleId: rule.id,
          conversationId: reclaimConversation.id,
          sourceMessageId: reclaimSource.id,
          actionMessageId: staleActionMessage.id,
          type: followUp.FOLLOW_UP_EVENT_TYPE,
          payload: {},
          status: "PROCESSING",
          idempotencyKey: `stage6c-stale-cancel-${suffix}`,
          attempts: 1,
          lockedAt: staleLockedAt,
          cancellationReason: "customer_replied",
        },
        select: { id: true },
      });
      const staleRun = await prisma.automationRun.create({
        data: {
          organizationId: organization.id,
          automationEventId: staleCancelled.id,
          provider: "n8n",
          status: "STARTED",
          attempt: 1,
          startedAt: staleLockedAt,
        },
        select: { id: true },
      });
      const reclaimResult = await queue.processDueAutomationEvents({
        now: new Date(),
        limit: 0,
      });
      assert.equal(reclaimResult.reclaimed, 1);
      assert.deepEqual(
        await prisma.automationEvent.findUnique({
          where: { id: staleCancelled.id },
          select: {
            status: true,
            cancellationReason: true,
            lockedAt: true,
            lastError: true,
          },
        }),
        {
          status: "CANCELLED",
          cancellationReason: "customer_replied",
          lockedAt: null,
          lastError: null,
        }
      );
      assert.deepEqual(
        await prisma.automationRun.findUnique({
          where: { id: staleRun.id },
          select: { status: true, errorCode: true, errorMessage: true },
        }),
        { status: "SUCCEEDED", errorCode: null, errorMessage: null }
      );
      assert.deepEqual(
        await prisma.message.findUnique({
          where: { id: staleActionMessage.id },
          select: { deliveryStatus: true, errorCode: true },
        }),
        { deliveryStatus: "FAILED", errorCode: "cancelled_before_send" }
      );
      assert.equal(rule.id.length > 0, true);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalEncryptionKey === undefined) {
        delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      } else {
        process.env.CREDENTIALS_ENCRYPTION_KEY = originalEncryptionKey;
      }
      if (originalGraphApiVersion === undefined) {
        delete process.env.META_GRAPH_API_VERSION;
      } else {
        process.env.META_GRAPH_API_VERSION = originalGraphApiVersion;
      }
      await prisma.organization.delete({ where: { id: organization.id } });
      await prisma.$disconnect();
    }
  }
);

test(
  "reglas DB: versión optimista y aislamiento entre organizaciones",
  { skip: !isExplicitSafeLocalDatabase() && "requiere opt-in y PostgreSQL local" },
  async () => {
    const [{ prisma }, rules] = await Promise.all([
      import("@/lib/prisma"),
      import("@/server/automation/rules"),
    ]);
    const suffix = randomUUID();
    const userId = randomUUID();
    const user = await prisma.user.create({
      data: {
        id: userId,
        name: "Etapa 6C rule test",
        email: `stage6c-rule-${suffix}@example.test`,
        emailVerified: false,
      },
      select: { id: true },
    });
    const organizationA = await prisma.organization.create({
      data: { name: "Etapa 6C rule A", slug: `stage6c-rule-a-${suffix}` },
      select: { id: true },
    });
    const organizationB = await prisma.organization.create({
      data: { name: "Etapa 6C rule B", slug: `stage6c-rule-b-${suffix}` },
      select: { id: true },
    });

    try {
      const ruleA = await prisma.organizationAutomationRule.create({
        data: {
          organizationId: organizationA.id,
          type: "HANDOFF_ALERT",
          enabled: false,
          config: { recipients: "BOTH" },
        },
        select: { id: true },
      });
      await prisma.organizationAutomationRule.create({
        data: {
          organizationId: organizationB.id,
          type: "HANDOFF_ALERT",
          enabled: false,
          config: { recipients: "BOTH" },
        },
      });

      const initial = (await rules.getAutomationRules(organizationA.id)).find(
        (rule) => rule.type === "HANDOFF_ALERT"
      );
      assert.equal(initial?.version, 1);
      const saved = await rules.updateAutomationRule({
        organizationId: organizationA.id,
        userId: user.id,
        rule: {
          type: "HANDOFF_ALERT",
          enabled: true,
          config: {
            ...DEFAULT_HANDOFF_CONFIG,
            recipients: "OWNERS_ADMINS",
            phoneNumbers: ["+12025550123"],
            templateName: "handoff_alert_test",
          },
          expectedVersion: initial?.version ?? null,
        },
      });
      assert.equal(saved.version, 2);
      assert.equal(saved.enabled, true);
      const redacted = (
        await rules.getAutomationRules(organizationA.id, {
          redactSensitiveConfig: true,
        })
      ).find((rule) => rule.type === "HANDOFF_ALERT");
      assert.deepEqual(
        redacted && "phoneNumbers" in redacted.config
          ? redacted.config.phoneNumbers
          : null,
        ["•••• 0123"]
      );
      const ruleAudit = await prisma.auditLog.findFirst({
        where: {
          organizationId: organizationA.id,
          action: "automation.rule_updated",
          entityId: ruleA.id,
        },
        orderBy: { createdAt: "desc" },
        select: { details: true },
      });
      assert.equal(JSON.stringify(ruleAudit?.details).includes("+12025550123"), false);

      await assert.rejects(
        rules.updateAutomationRule({
          organizationId: organizationA.id,
          userId: user.id,
          rule: {
            type: "HANDOFF_ALERT",
            enabled: false,
            config: { recipients: "ASSIGNED_AGENT" },
            expectedVersion: 1,
          },
        }),
        (error: unknown) => error instanceof rules.AutomationRuleConflictError
      );

      const other = await prisma.organizationAutomationRule.findUnique({
        where: {
          organizationId_type: {
            organizationId: organizationB.id,
            type: "HANDOFF_ALERT",
          },
        },
        select: { enabled: true, config: true, version: true },
      });
      assert.deepEqual(other, {
        enabled: false,
        config: { recipients: "BOTH" },
        version: 1,
      });

      const failedAt = new Date(Date.now() - 2_000);
      const succeededAt = new Date(Date.now() - 1_000);
      const retriedEvent = await prisma.automationEvent.create({
        data: {
          organizationId: organizationA.id,
          automationRuleId: ruleA.id,
          type: "conversation.handoff_requested",
          payload: {},
          status: "SUCCEEDED",
          idempotencyKey: `stage6c-rule-retry-${suffix}`,
          attempts: 2,
          processedAt: succeededAt,
        },
        select: { id: true },
      });
      await prisma.automationRun.createMany({
        data: [
          {
            organizationId: organizationA.id,
            automationEventId: retriedEvent.id,
            provider: "mock",
            status: "FAILED",
            attempt: 1,
            startedAt: failedAt,
            finishedAt: failedAt,
            errorCode: "temporary_failure",
          },
          {
            organizationId: organizationA.id,
            automationEventId: retriedEvent.id,
            provider: "mock",
            status: "SUCCEEDED",
            attempt: 2,
            startedAt: succeededAt,
            finishedAt: succeededAt,
          },
        ],
      });
      await prisma.automationEvent.create({
        data: {
          organizationId: organizationA.id,
          automationRuleId: ruleA.id,
          type: "conversation.handoff_requested",
          payload: {},
          status: "PENDING",
          idempotencyKey: `stage6c-rule-pending-${suffix}`,
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      });
      const afterRetry = (
        await rules.getAutomationRules(organizationA.id)
      ).find((rule) => rule.type === "HANDOFF_ALERT");
      assert.equal(afterRetry?.state, "WORKING");
      assert.equal(afterRetry?.lastError, "temporary_failure");
      assert.equal(afterRetry?.lastExecutionAt, succeededAt.toISOString());
    } finally {
      await prisma.organization.deleteMany({
        where: { id: { in: [organizationA.id, organizationB.id] } },
      });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.$disconnect();
    }
  }
);

test(
  "handoff WhatsApp DB: aislamiento, configuración, idempotencia y error seguro",
  { skip: !isExplicitSafeLocalDatabase() && "requiere opt-in y PostgreSQL local" },
  async () => {
    const [{ prisma }, action, meta] = await Promise.all([
      import("@/lib/prisma"),
      import("@/server/automation/handoff-alert-action"),
      import("@/server/whatsapp/meta-client"),
    ]);
    const suffix = randomUUID();
    const organizationA = await prisma.organization.create({
      data: { name: "Handoff action A", slug: `handoff-action-a-${suffix}` },
      select: { id: true },
    });
    const organizationB = await prisma.organization.create({
      data: { name: "Handoff action B", slug: `handoff-action-b-${suffix}` },
      select: { id: true },
    });

    const configA = {
      ...DEFAULT_HANDOFF_CONFIG,
      phoneNumbers: ["+12025550123", "+12025550124"],
      templateName: "handoff_alert_test",
      templateLanguage: "es_AR",
    };
    const configB = {
      ...DEFAULT_HANDOFF_CONFIG,
      phoneNumbers: ["+12025550125"],
      templateName: "handoff_alert_test_b",
      templateLanguage: "en_US",
    };

    try {
      const [ruleA, ruleB] = await Promise.all([
        prisma.organizationAutomationRule.create({
          data: {
            organizationId: organizationA.id,
            type: "HANDOFF_ALERT",
            enabled: true,
            config: configA,
          },
          select: { id: true },
        }),
        prisma.organizationAutomationRule.create({
          data: {
            organizationId: organizationB.id,
            type: "HANDOFF_ALERT",
            enabled: true,
            config: configB,
          },
          select: { id: true },
        }),
      ]);
      const [customerA, customerB] = await Promise.all([
        prisma.customer.create({
          data: { organizationId: organizationA.id, name: "Cliente A" },
          select: { id: true },
        }),
        prisma.customer.create({
          data: { organizationId: organizationB.id, name: "Cliente B" },
          select: { id: true },
        }),
      ]);
      const [integrationA, integrationB] = await Promise.all([
        prisma.whatsappIntegration.create({
          data: {
            organizationId: organizationA.id,
            wabaId: `test-waba-a-${suffix}`,
            phoneNumberId: "900000000000001",
            displayPhoneNumber: "+1 202 555 0101",
            verifiedName: "Test A",
            encryptedAccessToken: "test-encrypted-token-a",
            status: "CONNECTED",
          },
          select: { id: true },
        }),
        prisma.whatsappIntegration.create({
          data: {
            organizationId: organizationB.id,
            wabaId: `test-waba-b-${suffix}`,
            phoneNumberId: "900000000000002",
            displayPhoneNumber: "+1 202 555 0102",
            verifiedName: "Test B",
            encryptedAccessToken: "test-encrypted-token-b",
            status: "CONNECTED",
          },
          select: { id: true },
        }),
      ]);
      const [conversationA, conversationB] = await Promise.all([
        prisma.conversation.create({
          data: {
            organizationId: organizationA.id,
            customerId: customerA.id,
            whatsappIntegrationId: integrationA.id,
            channel: "whatsapp",
            status: "OPEN",
            handlingMode: "HUMAN",
          },
          select: { id: true },
        }),
        prisma.conversation.create({
          data: {
            organizationId: organizationB.id,
            customerId: customerB.id,
            whatsappIntegrationId: integrationB.id,
            channel: "whatsapp",
            status: "OPEN",
            handlingMode: "HUMAN",
          },
          select: { id: true },
        }),
      ]);
      // Una segunda conexión más nueva no puede sustituir silenciosamente la
      // integración vinculada a la conversación.
      await prisma.whatsappIntegration.create({
        data: {
          organizationId: organizationA.id,
          wabaId: `test-waba-a-secondary-${suffix}`,
          phoneNumberId: "900000000000003",
          displayPhoneNumber: "+1 202 555 0103",
          verifiedName: "Test A secundaria",
          encryptedAccessToken: "test-encrypted-token-a-secondary",
          status: "CONNECTED",
        },
      });

      async function createProcessingEvent(input: {
        organizationId: string;
        ruleId: string;
        conversationId: string;
        type?: string;
        provider?: string;
        label: string;
      }) {
        const lockedAt = new Date();
        const event = await prisma.automationEvent.create({
          data: {
            organizationId: input.organizationId,
            automationRuleId: input.ruleId,
            conversationId: input.conversationId,
            type: input.type ?? action.HANDOFF_ALERT_EVENT_TYPE,
            payload: {},
            status: "PROCESSING",
            idempotencyKey: `handoff-action-${input.label}-${suffix}`,
            attempts: 1,
            lockedAt,
          },
          select: { id: true },
        });
        await prisma.automationRun.create({
          data: {
            organizationId: input.organizationId,
            automationEventId: event.id,
            provider: input.provider ?? "n8n",
            status: "STARTED",
            attempt: 1,
            startedAt: lockedAt,
          },
        });
        return event;
      }

      const eventA = await createProcessingEvent({
        organizationId: organizationA.id,
        ruleId: ruleA.id,
        conversationId: conversationA.id,
        label: "a",
      });
      const sendCalls: Array<{
        to: string;
        templateName: string;
        phoneNumberId: string;
      }> = [];
      const sendTemplate = async (input: {
        to: string;
        templateName: string;
        phoneNumberId: string;
      }) => {
        sendCalls.push({
          to: input.to,
          templateName: input.templateName,
          phoneNumberId: input.phoneNumberId,
        });
        return { messageId: `test-meta-message-${sendCalls.length}` };
      };
      const commonDependencies = {
        getRecipientHashSecret: () => "test-recipient-hash-secret",
        decryptToken: () => "test-decrypted-access-token",
        sendTemplate,
        getProviderMode: () => "n8n" as const,
      };

      const mockMode = await action.executeHandoffAlertAction(
        { eventId: eventA.id, organizationId: organizationA.id },
        { ...commonDependencies, getProviderMode: () => "mock" as const }
      );
      assert.equal(mockMode.ok, false);
      assert.equal(!mockMode.ok && mockMode.code, "not_executable");
      assert.equal(sendCalls.length, 0);

      const wrongOrganization = await action.executeHandoffAlertAction(
        { eventId: eventA.id, organizationId: organizationB.id },
        commonDependencies
      );
      assert.deepEqual(wrongOrganization, {
        ok: false,
        code: "not_found",
        message: "No se encontró la acción solicitada.",
        retryable: false,
      });
      assert.equal(sendCalls.length, 0);

      const wrongEvent = await createProcessingEvent({
        organizationId: organizationA.id,
        ruleId: ruleA.id,
        conversationId: conversationA.id,
        type: "automation.test",
        label: "wrong-event",
      });
      const wrongEventResult = await action.executeHandoffAlertAction(
        { eventId: wrongEvent.id, organizationId: organizationA.id },
        commonDependencies
      );
      assert.equal(wrongEventResult.ok, false);
      assert.equal(!wrongEventResult.ok && wrongEventResult.code, "not_executable");
      assert.equal(sendCalls.length, 0);

      const mockRunEvent = await createProcessingEvent({
        organizationId: organizationA.id,
        ruleId: ruleA.id,
        conversationId: conversationA.id,
        provider: "mock",
        label: "mock-provider",
      });
      const mockRunResult = await action.executeHandoffAlertAction(
        { eventId: mockRunEvent.id, organizationId: organizationA.id },
        commonDependencies
      );
      assert.equal(mockRunResult.ok, false);
      assert.equal(!mockRunResult.ok && mockRunResult.code, "not_executable");
      assert.equal(sendCalls.length, 0);

      await prisma.organizationAutomationRule.update({
        where: { id: ruleA.id },
        data: { config: { ...configA, templateName: "" } },
      });
      const missingTemplate = await action.executeHandoffAlertAction(
        { eventId: eventA.id, organizationId: organizationA.id },
        commonDependencies
      );
      assert.equal(missingTemplate.ok, false);
      assert.equal(!missingTemplate.ok && missingTemplate.code, "template_missing");

      await prisma.organizationAutomationRule.update({
        where: { id: ruleA.id },
        data: {
          config: { ...configA, phoneNumbers: ["not-e164"] },
        },
      });
      const invalidRecipients = await action.executeHandoffAlertAction(
        { eventId: eventA.id, organizationId: organizationA.id },
        commonDependencies
      );
      assert.equal(invalidRecipients.ok, false);
      assert.equal(
        !invalidRecipients.ok && invalidRecipients.code,
        "invalid_recipients"
      );
      assert.equal(sendCalls.length, 0);
      await prisma.organizationAutomationRule.update({
        where: { id: ruleA.id },
        data: { config: configA },
      });

      const claimNow = new Date();
      await prisma.automationEvent.update({
        where: { id: eventA.id },
        data: { lockedAt: new Date(claimNow.getTime() - 10 * 60 * 1000) },
      });
      let releaseFirst!: () => void;
      let notifyClaimed!: () => void;
      const releasePromise = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const claimedPromise = new Promise<void>((resolve) => {
        notifyClaimed = resolve;
      });
      const first = action.executeHandoffAlertAction(
        { eventId: eventA.id, organizationId: organizationA.id },
        {
          ...commonDependencies,
          now: () => claimNow,
          afterClaim: async () => {
            notifyClaimed();
            await releasePromise;
          },
        }
      );
      await claimedPromise;
      const refreshedClaim = await prisma.automationEvent.findFirst({
        where: { id: eventA.id, organizationId: organizationA.id },
        select: { actionClaimedAt: true, lockedAt: true },
      });
      assert.equal(
        refreshedClaim?.actionClaimedAt?.getTime(),
        claimNow.getTime()
      );
      assert.equal(refreshedClaim?.lockedAt?.getTime(), claimNow.getTime());
      const concurrentRetry = await action.executeHandoffAlertAction(
        { eventId: eventA.id, organizationId: organizationA.id },
        commonDependencies
      );
      assert.equal(concurrentRetry.ok, true);
      assert.equal(concurrentRetry.ok && concurrentRetry.state, "in_progress");
      releaseFirst();
      const firstResult = await first;
      assert.equal(firstResult.ok, true);
      assert.equal(firstResult.ok && firstResult.state, "success");
      assert.equal(sendCalls.length, 2);
      assert.deepEqual(
        sendCalls.map((call) => call.to),
        configA.phoneNumbers
      );
      assert.equal(
        sendCalls.every((call) => call.phoneNumberId === "900000000000001"),
        true
      );

      const duplicate = await action.executeHandoffAlertAction(
        { eventId: eventA.id, organizationId: organizationA.id },
        commonDependencies
      );
      assert.equal(duplicate.ok, true);
      assert.equal(duplicate.ok && duplicate.state, "already_sent");
      assert.equal(sendCalls.length, 2);
      const storedA = await prisma.automationEvent.findFirst({
        where: { id: eventA.id, organizationId: organizationA.id },
        select: {
          actionClaimedAt: true,
          actionCompletedAt: true,
          actionDeliveries: {
            select: {
              status: true,
              recipientHash: true,
              templateName: true,
            },
          },
        },
      });
      assert.equal(storedA?.actionClaimedAt instanceof Date, true);
      assert.equal(storedA?.actionCompletedAt instanceof Date, true);
      assert.equal(storedA?.actionDeliveries.length, 2);
      assert.equal(
        storedA?.actionDeliveries.every((delivery) => delivery.status === "SENT"),
        true
      );
      assert.equal(
        JSON.stringify(storedA?.actionDeliveries).includes("+1202555"),
        false
      );

      const eventB = await createProcessingEvent({
        organizationId: organizationB.id,
        ruleId: ruleB.id,
        conversationId: conversationB.id,
        label: "b",
      });
      const resultB = await action.executeHandoffAlertAction(
        { eventId: eventB.id, organizationId: organizationB.id },
        commonDependencies
      );
      assert.equal(resultB.ok, true);
      assert.deepEqual(sendCalls.slice(2).map((call) => call.to), [
        "+12025550125",
      ]);

      const failedEvent = await createProcessingEvent({
        organizationId: organizationA.id,
        ruleId: ruleA.id,
        conversationId: conversationA.id,
        label: "meta-failure",
      });
      let failingCalls = 0;
      const failed = await action.executeHandoffAlertAction(
        { eventId: failedEvent.id, organizationId: organizationA.id },
        {
          ...commonDependencies,
          sendTemplate: async () => {
            failingCalls += 1;
            throw new meta.MetaApiError({
              code: "authentication",
              safeMessage: "Meta rechazó la configuración de WhatsApp.",
            });
          },
        }
      );
      assert.equal(failed.ok, false);
      assert.equal(!failed.ok && failed.code, "send_failed");
      assert.equal(!failed.ok && failed.retryable, false);
      assert.equal(
        !failed.ok && failed.message,
        "Meta rechazó la configuración de WhatsApp."
      );
      assert.equal(JSON.stringify(failed).includes("test-decrypted"), false);
      assert.equal(failingCalls, 2);

      const retryAfterFailure = await action.executeHandoffAlertAction(
        { eventId: failedEvent.id, organizationId: organizationA.id },
        commonDependencies
      );
      assert.equal(retryAfterFailure.ok, false);
      assert.equal(
        !retryAfterFailure.ok && retryAfterFailure.code,
        "send_failed"
      );
      assert.equal(failingCalls, 2);
      const failedDeliveries = await prisma.automationActionDelivery.findMany({
        where: {
          organizationId: organizationA.id,
          eventId: failedEvent.id,
        },
        select: { status: true, errorCode: true, errorMessage: true },
      });
      assert.equal(failedDeliveries.length, 2);
      assert.equal(
        failedDeliveries.every(
          (delivery) =>
            delivery.status === "FAILED" &&
            delivery.errorCode === "meta_authentication"
        ),
        true
      );
      assert.equal(
        JSON.stringify(failedDeliveries).includes("test-decrypted"),
        false
      );

      const audits = await prisma.auditLog.findMany({
        where: {
          organizationId: organizationA.id,
          action: {
            in: [
              "automation.handoff_alert_sent",
              "automation.handoff_alert_failed",
            ],
          },
        },
        select: { details: true },
      });
      assert.equal(audits.length >= 2, true);
      assert.equal(JSON.stringify(audits).includes("+1202555"), false);
    } finally {
      await prisma.organization.deleteMany({
        where: { id: { in: [organizationA.id, organizationB.id] } },
      });
      await prisma.$disconnect();
    }
  }
);
