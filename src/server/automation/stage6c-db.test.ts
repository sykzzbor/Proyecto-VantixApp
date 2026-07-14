import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadEnvConfig } from "@next/env";
import { DEFAULT_FOLLOW_UP_CONFIG } from "@/lib/validations/automation-rules";

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
          config: { recipients: "OWNERS_ADMINS" },
          expectedVersion: initial?.version ?? null,
        },
      });
      assert.equal(saved.version, 2);
      assert.equal(saved.enabled, true);

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
