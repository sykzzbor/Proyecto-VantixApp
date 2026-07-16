import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/server/rate-limit";
import {
  ingestWhatsappWebhookEvents,
  runWhatsappAutomationJobs,
} from "@/server/whatsapp/processing";
import { resolveYCloudIntegration } from "@/server/whatsapp/persistence";
import { parseYCloudWebhookPayload } from "@/server/whatsapp/ycloud-parser";
import { verifyYCloudWebhookSignature } from "@/server/whatsapp/ycloud-signature";

const MAX_WEBHOOK_BYTES = 512 * 1024;
const INVALID_LOG_LIMIT = 10;
const INVALID_LOG_WINDOW_MS = 60_000;

type ScheduleTask = (task: () => Promise<void>) => void;

type YCloudWebhookDependencies = {
  verifySignature: typeof verifyYCloudWebhookSignature;
  parsePayload: typeof parseYCloudWebhookPayload;
  resolveIntegration: typeof resolveYCloudIntegration;
  receiptExists: (eventId: string) => Promise<boolean>;
  recordReceipt: (input: {
    eventId: string;
    eventType: string;
    organizationId: string;
    integrationId: string;
  }) => Promise<void>;
  ingest: typeof ingestWhatsappWebhookEvents;
};

async function defaultReceiptExists(eventId: string) {
  const receipt = await prisma.whatsappWebhookReceipt.findUnique({
    where: {
      provider_externalEventId: {
        provider: "YCLOUD",
        externalEventId: eventId,
      },
    },
    select: { id: true },
  });
  return Boolean(receipt);
}

async function defaultRecordReceipt(input: {
  eventId: string;
  eventType: string;
  organizationId: string;
  integrationId: string;
}) {
  try {
    await prisma.whatsappWebhookReceipt.create({
      data: {
        provider: "YCLOUD",
        externalEventId: input.eventId,
        eventType: input.eventType,
        organizationId: input.organizationId,
        integrationId: input.integrationId,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return;
    }
    throw error;
  }
}

const defaultDependencies: YCloudWebhookDependencies = {
  verifySignature: verifyYCloudWebhookSignature,
  parsePayload: parseYCloudWebhookPayload,
  resolveIntegration: resolveYCloudIntegration,
  receiptExists: defaultReceiptExists,
  recordReceipt: defaultRecordReceipt,
  ingest: ingestWhatsappWebhookEvents,
};

function logInvalid(reason: "signature" | "payload" | "configuration") {
  const rate = checkRateLimit(
    `ycloud-invalid-webhook:${reason}`,
    INVALID_LOG_LIMIT,
    INVALID_LOG_WINDOW_MS
  );
  if (rate.allowed) {
    console.warn(`[VantixApp] Webhook de YCloud inválido (${reason}).`);
  }
}

function textResponse(body: string, status: number) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function handleYCloudWebhookPost(
  request: Request,
  schedule: ScheduleTask,
  overrides: Partial<YCloudWebhookDependencies> = {}
): Promise<Response> {
  const dependencies = { ...defaultDependencies, ...overrides };
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
      !dependencies.verifySignature(
        rawBody,
        request.headers.get("ycloud-signature")
      )
    ) {
      logInvalid("signature");
      return textResponse("Firma inválida.", 401);
    }
  } catch {
    logInvalid("configuration");
    return textResponse("Webhook no configurado.", 503);
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody) as unknown;
  } catch {
    logInvalid("payload");
    return textResponse("Payload inválido.", 400);
  }

  let parsed: ReturnType<typeof parseYCloudWebhookPayload>;
  try {
    parsed = dependencies.parsePayload(input);
  } catch {
    logInvalid("payload");
    return textResponse("Payload inválido.", 400);
  }
  if (parsed.ignored) {
    return Response.json({ received: true, ignored: true }, { status: 200 });
  }

  try {
    const integration = await dependencies.resolveIntegration({
      phoneNumber: parsed.event.phoneNumberId,
      wabaId: parsed.event.wabaId ?? "",
    });
    if (!integration || integration.provider !== "YCLOUD") {
      return Response.json({ received: true, ignored: true }, { status: 200 });
    }
    if (await dependencies.receiptExists(parsed.eventId)) {
      return Response.json({ received: true, duplicate: true }, { status: 200 });
    }
    const jobs = await dependencies.ingest([parsed.event], {
      resolveIntegration: async () => integration,
      onUnknownNumber: () => undefined,
    });
    await dependencies.recordReceipt({
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      organizationId: integration.organizationId,
      integrationId: integration.id,
    });
    if (jobs.length > 0) schedule(() => runWhatsappAutomationJobs(jobs));
  } catch (error) {
    console.error(
      "[VantixApp] No se pudo persistir un webhook válido de YCloud:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return textResponse("No se pudo procesar el evento.", 500);
  }
  return Response.json({ received: true }, { status: 200 });
}
