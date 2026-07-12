import { recordAudit } from "@/server/audit";
import {
  applyWhatsappStatus,
  persistIncomingWhatsappMessage,
  resolveWhatsappIntegration,
  touchWhatsappIntegration,
  type PersistInboundResult,
} from "@/server/whatsapp/persistence";
import type {
  ResolvedWhatsappIntegration,
  WhatsappInboundEvent,
  WhatsappStatusEvent,
  WhatsappWebhookEvent,
} from "@/server/whatsapp/types";

type NewInboundResult = Extract<PersistInboundResult, { duplicate: false }>;

export type WhatsappAutomationJob = {
  integration: ResolvedWhatsappIntegration;
  event: WhatsappInboundEvent;
  persisted: NewInboundResult;
};

type ProcessingDependencies = {
  resolveIntegration: typeof resolveWhatsappIntegration;
  persistIncoming: typeof persistIncomingWhatsappMessage;
  applyStatus: typeof applyWhatsappStatus;
  touchIntegration: typeof touchWhatsappIntegration;
  audit: typeof recordAudit;
  onUnknownNumber: (phoneNumberId: string) => void;
};

const defaultDependencies: ProcessingDependencies = {
  resolveIntegration: resolveWhatsappIntegration,
  persistIncoming: persistIncomingWhatsappMessage,
  applyStatus: applyWhatsappStatus,
  touchIntegration: touchWhatsappIntegration,
  audit: recordAudit,
  onUnknownNumber: () => {
    // No se registra el ID ni el payload porque todavía no existe un tenant
    // confiable al cual atribuir el evento.
    console.warn("[VantixApp] Webhook de WhatsApp para un número no registrado.");
  },
};

/**
 * Hace únicamente la parte durable y acotada del webhook. La ruta espera este
 * resultado antes de responder 200; las llamadas a IA/Meta se ejecutan luego.
 */
export async function ingestWhatsappWebhookEvents(
  events: WhatsappWebhookEvent[],
  overrides: Partial<ProcessingDependencies> = {}
): Promise<WhatsappAutomationJob[]> {
  const deps = { ...defaultDependencies, ...overrides };
  const integrations = new Map<string, ResolvedWhatsappIntegration | null>();
  const touched = new Set<string>();
  const jobs: WhatsappAutomationJob[] = [];

  async function integrationFor(phoneNumberId: string) {
    if (integrations.has(phoneNumberId)) {
      return integrations.get(phoneNumberId) ?? null;
    }
    const integration = await deps.resolveIntegration(phoneNumberId);
    integrations.set(phoneNumberId, integration);
    if (!integration) deps.onUnknownNumber(phoneNumberId);
    return integration;
  }

  for (const event of events) {
    const integration = await integrationFor(event.phoneNumberId);
    if (!integration) continue;
    touched.add(integration.id);

    if (event.kind === "message") {
      const persisted = await deps.persistIncoming(event, {
        organizationId: integration.organizationId,
        integrationId: integration.id,
      });
      if (persisted.duplicate) continue;

      await deps.audit({
        organizationId: integration.organizationId,
        userId: null,
        action: "whatsapp.mensaje_recibido",
        entityType: "conversation",
        entityId: persisted.conversationId,
        details: { tipo: event.messageType, canal: "whatsapp" },
      });

      if (persisted.handlingMode === "AI") {
        jobs.push({ integration, event, persisted });
      }
      continue;
    }

    const statusEvent: WhatsappStatusEvent = event;
    const applied = await deps.applyStatus(statusEvent, integration.organizationId);
    if (
      applied.found &&
      applied.changed &&
      applied.deliveryStatus === "FAILED"
    ) {
      await deps.audit({
        organizationId: integration.organizationId,
        userId: null,
        action: "whatsapp.envio_fallido",
        entityType: "message",
        entityId: applied.messageId,
        details: statusEvent.errorCode
          ? { codigo: statusEvent.errorCode }
          : undefined,
      });
    }
  }

  await Promise.all([...touched].map((id) => deps.touchIntegration(id)));
  return jobs;
}

export async function runWhatsappAutomationJobs(jobs: WhatsappAutomationJob[]) {
  if (jobs.length === 0) return;
  const { handleWhatsappAutomaticResponse } = await import(
    "@/server/whatsapp/automation"
  );
  for (const job of jobs) {
    try {
      await handleWhatsappAutomaticResponse(job);
    } catch (error) {
      // Nunca incluir contenido, payloads ni credenciales en logs.
      console.error(
        "[VantixApp] Falló el procesamiento automático de WhatsApp:",
        error instanceof Error ? error.name : "unknown_error"
      );
    }
  }
}
