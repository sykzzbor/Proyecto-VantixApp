import { checkRateLimit } from "@/server/rate-limit";
import { recordAudit } from "@/server/audit";
import { parseWhatsappWebhookPayload } from "@/server/whatsapp/parser";
import { resolveWhatsappIntegration } from "@/server/whatsapp/persistence";
import {
  ingestWhatsappWebhookEvents,
  runWhatsappAutomationJobs,
} from "@/server/whatsapp/processing";
import {
  verifyWebhookSignature,
  verifyWebhookToken,
} from "@/server/whatsapp/signature";

const MAX_WEBHOOK_BYTES = 512 * 1024;
const INVALID_LOG_LIMIT = 10;
const INVALID_LOG_WINDOW_MS = 60_000;

type ScheduleTask = (task: () => Promise<void>) => void;

function textResponse(body: string, status: number) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function logInvalidWebhook(reason: "signature" | "payload" | "configuration") {
  const rate = checkRateLimit(
    `whatsapp-invalid-webhook:${reason}`,
    INVALID_LOG_LIMIT,
    INVALID_LOG_WINDOW_MS
  );
  if (rate.allowed) {
    // Log operacional global: no hay una organización confiable a la cual
    // asociar audit_logs y no se incluye ningún ID, header ni payload.
    console.warn(`[VantixApp] Webhook de WhatsApp inválido (${reason}).`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Solo para payloads cuya firma ya fue validada; nunca persiste el body. */
async function auditInvalidSignedPayload(input: unknown) {
  if (!isRecord(input) || !Array.isArray(input.entry)) return;
  const phoneNumberIds = new Set<string>();
  for (const entry of input.entry.slice(0, 10)) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes.slice(0, 10)) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const metadata = change.value.metadata;
      if (!isRecord(metadata) || typeof metadata.phone_number_id !== "string") {
        continue;
      }
      phoneNumberIds.add(metadata.phone_number_id);
    }
  }

  for (const phoneNumberId of [...phoneNumberIds].slice(0, 5)) {
    try {
      const integration = await resolveWhatsappIntegration(phoneNumberId);
      if (!integration) continue;
      await recordAudit({
        organizationId: integration.organizationId,
        userId: null,
        action: "whatsapp.webhook_invalido",
        entityType: "whatsapp_integration",
        entityId: integration.id,
        details: { motivo: "payload_invalido" },
      });
    } catch {
      // La auditoría es best-effort y no cambia la respuesta del webhook.
    }
  }
}

export function handleWhatsappWebhookVerification(request: Request): Response {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !challenge) {
    return textResponse("Verificación inválida.", 403);
  }

  try {
    if (!verifyWebhookToken(token)) {
      return textResponse("Verificación inválida.", 403);
    }
  } catch {
    logInvalidWebhook("configuration");
    return textResponse("Webhook no configurado.", 503);
  }

  return textResponse(challenge, 200);
}

export async function handleWhatsappWebhookPost(
  request: Request,
  schedule: ScheduleTask
): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return textResponse("Payload demasiado grande.", 413);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return textResponse("Solicitud inválida.", 400);
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return textResponse("Payload demasiado grande.", 413);
  }

  try {
    if (
      !verifyWebhookSignature(
        rawBody,
        request.headers.get("x-hub-signature-256")
      )
    ) {
      logInvalidWebhook("signature");
      return textResponse("Firma inválida.", 401);
    }
  } catch {
    logInvalidWebhook("configuration");
    return textResponse("Webhook no configurado.", 503);
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody) as unknown;
  } catch {
    logInvalidWebhook("payload");
    return textResponse("Payload inválido.", 400);
  }

  let events;
  try {
    events = parseWhatsappWebhookPayload(input);
  } catch {
    logInvalidWebhook("payload");
    await auditInvalidSignedPayload(input);
    return textResponse("Payload inválido.", 400);
  }

  try {
    // Se espera únicamente la persistencia acotada. Si falla, Meta recibe 500
    // y puede reintentar; la idempotencia evita duplicados.
    const jobs = await ingestWhatsappWebhookEvents(events);
    if (jobs.length > 0) {
      schedule(() => runWhatsappAutomationJobs(jobs));
    }
  } catch (error) {
    console.error(
      "[VantixApp] No se pudo persistir un webhook válido de WhatsApp:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return textResponse("No se pudo procesar el evento.", 500);
  }

  return Response.json({ received: true }, { status: 200 });
}
