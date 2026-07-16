import { z } from "zod";
import type {
  WhatsappDeliveryStatus,
  WhatsappInboundEvent,
  WhatsappMessageType,
  WhatsappStatusEvent,
} from "@/server/whatsapp/types";

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const idSchema = z.string().trim().min(1).max(512);
const dateSchema = z.string().datetime({ offset: true });

const commonEventSchema = z
  .object({
    id: idSchema,
    type: z.string().trim().min(1).max(120),
    apiVersion: z.literal("v2"),
    createTime: dateSchema,
  })
  .passthrough();

const mediaSchema = z
  .object({
    id: z.string().trim().max(255).optional(),
    mime_type: z.string().trim().max(120).optional(),
    filename: z.string().trim().max(240).optional(),
    caption: z.string().trim().max(1000).optional(),
  })
  .passthrough();

const inboundMessageSchema = z
  .object({
    id: idSchema,
    wamid: idSchema.optional(),
    wabaId: idSchema,
    from: z.string().trim().regex(E164_PATTERN),
    fromUserId: z.string().trim().max(255).optional(),
    fromParentUserId: z.string().trim().max(255).optional(),
    to: z.string().trim().regex(E164_PATTERN),
    customerProfile: z
      .object({
        name: z.string().trim().max(80).optional(),
        username: z.string().trim().max(80).optional(),
      })
      .passthrough()
      .optional(),
    sendTime: dateSchema.optional(),
    type: z.string().trim().min(1).max(80),
    text: z.object({ body: z.string().max(4096) }).passthrough().optional(),
    audio: mediaSchema.optional(),
    image: mediaSchema.optional(),
    document: mediaSchema.optional(),
    sticker: mediaSchema.optional(),
    video: mediaSchema.optional(),
    location: z
      .object({
        latitude: z.number(),
        longitude: z.number(),
        name: z.string().trim().max(200).optional(),
        address: z.string().trim().max(300).optional(),
      })
      .passthrough()
      .optional(),
    context: z.object({ id: idSchema.optional() }).passthrough().optional(),
  })
  .passthrough();

const messageUpdateSchema = z
  .object({
    id: idSchema,
    wamid: idSchema.optional(),
    wabaId: idSchema,
    from: z.string().trim().regex(E164_PATTERN),
    to: z.string().trim().max(255).optional(),
    status: z.enum(["failed", "sent", "delivered", "read"]),
    externalId: z.string().trim().min(1).max(255).optional(),
    errorCode: z.union([z.string(), z.number()]).optional(),
    createTime: dateSchema.optional(),
    updateTime: dateSchema.optional(),
    sendTime: dateSchema.optional(),
    deliverTime: dateSchema.optional(),
    readTime: dateSchema.optional(),
  })
  .passthrough();

const inboundEventSchema = commonEventSchema.extend({
  type: z.literal("whatsapp.inbound_message.received"),
  whatsappInboundMessage: inboundMessageSchema,
});

const statusEventSchema = commonEventSchema.extend({
  type: z.literal("whatsapp.message.updated"),
  whatsappMessage: messageUpdateSchema,
});

function normalizeType(type: string): WhatsappMessageType {
  const supported: WhatsappMessageType[] = [
    "text",
    "audio",
    "image",
    "document",
    "sticker",
    "location",
    "video",
    "interactive",
    "button",
    "reaction",
  ];
  return supported.includes(type as WhatsappMessageType)
    ? (type as WhatsappMessageType)
    : "unknown";
}

function describeInbound(message: z.infer<typeof inboundMessageSchema>) {
  const trim = (value: string | undefined, max: number) =>
    value?.trim().slice(0, max) || undefined;
  switch (message.type) {
    case "text":
      return trim(message.text?.body, 4096) ?? "[Mensaje de texto vacío]";
    case "audio":
      return "[Audio recibido]";
    case "image":
      return trim(message.image?.caption, 1000)
        ? `[Imagen recibida] ${trim(message.image?.caption, 1000)}`
        : "[Imagen recibida]";
    case "document":
      return trim(message.document?.filename, 240)
        ? `[Documento recibido: ${trim(message.document?.filename, 240)}]`
        : "[Documento recibido]";
    case "sticker":
      return "[Sticker recibido]";
    case "location": {
      const label = [message.location?.name, message.location?.address]
        .map((value) => value?.trim())
        .filter(Boolean)
        .join(" · ");
      return label ? `[Ubicación recibida] ${label}` : "[Ubicación recibida]";
    }
    case "video":
      return trim(message.video?.caption, 1000)
        ? `[Video recibido] ${trim(message.video?.caption, 1000)}`
        : "[Video recibido]";
    default:
      return `[Mensaje de WhatsApp: ${normalizeType(message.type)}]`;
  }
}

function inboundMetadata(message: z.infer<typeof inboundMessageSchema>) {
  const media =
    message.audio ??
    message.image ??
    message.document ??
    message.sticker ??
    message.video;
  return {
    source: "whatsapp",
    provider: "ycloud",
    messageType: normalizeType(message.type),
    ycloudMessageId: message.id,
    ...(message.wamid ? { whatsappMessageId: message.wamid } : {}),
    ...(message.fromUserId ? { whatsappUserId: message.fromUserId } : {}),
    ...(message.fromParentUserId
      ? { whatsappParentUserId: message.fromParentUserId }
      : {}),
    ...(message.context?.id ? { contextMessageId: message.context.id } : {}),
    ...(media
      ? {
          media: {
            ...(media.id ? { id: media.id } : {}),
            ...(media.mime_type ? { mimeType: media.mime_type } : {}),
            ...(media.filename ? { filename: media.filename } : {}),
          },
        }
      : {}),
    ...(message.location
      ? {
          location: {
            latitude: message.location.latitude,
            longitude: message.location.longitude,
            ...(message.location.name ? { name: message.location.name } : {}),
            ...(message.location.address
              ? { address: message.location.address }
              : {}),
          },
        }
      : {}),
  };
}

function toInbound(
  event: z.infer<typeof inboundEventSchema>
): WhatsappInboundEvent {
  const message = event.whatsappInboundMessage;
  const customerName =
    message.customerProfile?.name?.trim() ||
    message.customerProfile?.username?.trim() ||
    `Contacto ${message.from.slice(-4)}`;
  return {
    kind: "message",
    provider: "YCLOUD",
    webhookEventId: event.id,
    wabaId: message.wabaId,
    phoneNumberId: message.to,
    externalMessageId: message.id,
    whatsappMessageId: message.wamid ?? null,
    from: message.from,
    customerName,
    timestamp: message.sendTime ?? event.createTime,
    messageType: normalizeType(message.type),
    content: describeInbound(message),
    metadata: inboundMetadata(message),
  };
}

function toStatus(event: z.infer<typeof statusEventSchema>): WhatsappStatusEvent {
  const message = event.whatsappMessage;
  return {
    kind: "status",
    provider: "YCLOUD",
    webhookEventId: event.id,
    wabaId: message.wabaId,
    phoneNumberId: message.from,
    externalMessageId: message.id,
    whatsappMessageId: message.wamid ?? null,
    internalMessageId: message.externalId ?? null,
    timestamp:
      message.readTime ??
      message.deliverTime ??
      message.sendTime ??
      message.updateTime ??
      message.createTime ??
      event.createTime,
    deliveryStatus: message.status.toUpperCase() as Exclude<
      WhatsappDeliveryStatus,
      "PENDING"
    >,
    errorCode:
      message.status === "failed" && message.errorCode !== undefined
        ? String(message.errorCode).slice(0, 100)
        : null,
    errorMessage:
      message.status === "failed"
        ? "YCloud informó que el mensaje no pudo entregarse."
        : null,
  };
}

export type ParsedYCloudWebhook =
  | {
      ignored: true;
      eventId: string;
      eventType: string;
    }
  | {
      ignored: false;
      eventId: string;
      eventType:
        | "whatsapp.inbound_message.received"
        | "whatsapp.message.updated";
      event: WhatsappInboundEvent | WhatsappStatusEvent;
    };

export function parseYCloudWebhookPayload(input: unknown): ParsedYCloudWebhook {
  const common = commonEventSchema.parse(input);
  if (common.type === "whatsapp.inbound_message.received") {
    const parsed = inboundEventSchema.parse(input);
    return {
      ignored: false,
      eventId: parsed.id,
      eventType: parsed.type,
      event: toInbound(parsed),
    };
  }
  if (common.type === "whatsapp.message.updated") {
    const parsed = statusEventSchema.parse(input);
    return {
      ignored: false,
      eventId: parsed.id,
      eventType: parsed.type,
      event: toStatus(parsed),
    };
  }
  return { ignored: true, eventId: common.id, eventType: common.type };
}
