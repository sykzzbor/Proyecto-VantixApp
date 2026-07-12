import { z } from "zod";
import type {
  WhatsappDeliveryStatus,
  WhatsappInboundEvent,
  WhatsappMessageType,
  WhatsappStatusEvent,
  WhatsappWebhookEvent,
} from "@/server/whatsapp/types";

const mediaSchema = z
  .object({
    id: z.string().optional(),
    mime_type: z.string().optional(),
    sha256: z.string().optional(),
    filename: z.string().optional(),
    caption: z.string().optional(),
  })
  .passthrough();

const locationSchema = z
  .object({
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
  })
  .passthrough();

const messageSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    timestamp: z.string().optional(),
    type: z.string().min(1),
    text: z.object({ body: z.string() }).passthrough().optional(),
    audio: mediaSchema.optional(),
    image: mediaSchema.optional(),
    document: mediaSchema.optional(),
    sticker: mediaSchema.optional(),
    video: mediaSchema.optional(),
    location: locationSchema.optional(),
    context: z.object({ id: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const contactSchema = z
  .object({
    wa_id: z.string().min(1),
    profile: z.object({ name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const statusSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["sent", "delivered", "read", "failed"]),
    timestamp: z.string().optional(),
    errors: z
      .array(
        z
          .object({
            code: z.union([z.string(), z.number()]).optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

const valueSchema = z
  .object({
    messaging_product: z.literal("whatsapp").optional(),
    metadata: z
      .object({
        phone_number_id: z.string().min(1),
      })
      .passthrough(),
    contacts: z.array(contactSchema).optional(),
    messages: z.array(messageSchema).optional(),
    statuses: z.array(statusSchema).optional(),
  })
  .passthrough();

const webhookPayloadSchema = z
  .object({
    object: z.literal("whatsapp_business_account"),
    entry: z.array(
      z
        .object({
          changes: z.array(
            z
              .object({
                field: z.string().optional(),
                value: valueSchema,
              })
              .passthrough()
          ),
        })
        .passthrough()
    ),
  })
  .passthrough();

function trimTo(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function normalizeMessageType(type: string): WhatsappMessageType {
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

function mediaMetadata(message: z.infer<typeof messageSchema>) {
  const media =
    message.audio ??
    message.image ??
    message.document ??
    message.sticker ??
    message.video;
  if (!media) return undefined;

  return {
    ...(trimTo(media.id, 200) ? { id: trimTo(media.id, 200) } : {}),
    ...(trimTo(media.mime_type, 120)
      ? { mimeType: trimTo(media.mime_type, 120) }
      : {}),
    ...(trimTo(media.sha256, 128) ? { sha256: trimTo(media.sha256, 128) } : {}),
    ...(trimTo(media.filename, 240)
      ? { filename: trimTo(media.filename, 240) }
      : {}),
  };
}

function describeMessage(message: z.infer<typeof messageSchema>): string {
  switch (message.type) {
    case "text":
      return trimTo(message.text?.body, 4000) ?? "[Mensaje de texto vacío]";
    case "audio":
      return "[Audio recibido]";
    case "image": {
      const caption = trimTo(message.image?.caption, 1000);
      return caption ? `[Imagen recibida] ${caption}` : "[Imagen recibida]";
    }
    case "document": {
      const filename = trimTo(message.document?.filename, 240);
      const caption = trimTo(message.document?.caption, 1000);
      return [filename ? `[Documento recibido: ${filename}]` : "[Documento recibido]", caption]
        .filter(Boolean)
        .join(" ");
    }
    case "sticker":
      return "[Sticker recibido]";
    case "location": {
      const label = [
        trimTo(message.location?.name, 200),
        trimTo(message.location?.address, 300),
      ]
        .filter(Boolean)
        .join(" · ");
      return label ? `[Ubicación recibida] ${label}` : "[Ubicación recibida]";
    }
    case "video": {
      const caption = trimTo(message.video?.caption, 1000);
      return caption ? `[Video recibido] ${caption}` : "[Video recibido]";
    }
    default:
      return `[Mensaje de WhatsApp: ${normalizeMessageType(message.type)}]`;
  }
}

function toInboundEvent(
  phoneNumberId: string,
  message: z.infer<typeof messageSchema>,
  contacts: z.infer<typeof contactSchema>[]
): WhatsappInboundEvent {
  const contact = contacts.find((item) => item.wa_id === message.from) ?? contacts[0];
  const customerName =
    trimTo(contact?.profile?.name, 80) ?? `Contacto ${message.from.slice(-4)}`;
  const media = mediaMetadata(message);
  const location = message.location
    ? {
        latitude: message.location.latitude,
        longitude: message.location.longitude,
        ...(trimTo(message.location.name, 200)
          ? { name: trimTo(message.location.name, 200) }
          : {}),
        ...(trimTo(message.location.address, 300)
          ? { address: trimTo(message.location.address, 300) }
          : {}),
      }
    : undefined;

  return {
    kind: "message",
    phoneNumberId,
    externalMessageId: message.id,
    from: contact?.wa_id ?? message.from,
    customerName,
    timestamp: message.timestamp ?? null,
    messageType: normalizeMessageType(message.type),
    content: describeMessage(message),
    metadata: {
      source: "whatsapp",
      messageType: normalizeMessageType(message.type),
      ...(message.timestamp ? { timestamp: message.timestamp } : {}),
      ...(message.context?.id ? { contextMessageId: message.context.id } : {}),
      ...(media && Object.keys(media).length > 0 ? { media } : {}),
      ...(location ? { location } : {}),
    },
  };
}

function toStatusEvent(
  phoneNumberId: string,
  status: z.infer<typeof statusSchema>
): WhatsappStatusEvent {
  const deliveryStatus = status.status.toUpperCase() as Exclude<
    WhatsappDeliveryStatus,
    "PENDING"
  >;
  const rawCode = status.errors?.[0]?.code;
  const errorCode = rawCode === undefined ? null : String(rawCode).slice(0, 60);

  return {
    kind: "status",
    phoneNumberId,
    externalMessageId: status.id,
    timestamp: status.timestamp ?? null,
    deliveryStatus,
    errorCode,
    errorMessage:
      deliveryStatus === "FAILED"
        ? "WhatsApp informó que el mensaje no pudo entregarse."
        : null,
  };
}

export function parseWhatsappWebhookPayload(input: unknown): WhatsappWebhookEvent[] {
  const payload = webhookPayloadSchema.parse(input);
  const events: WhatsappWebhookEvent[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field && change.field !== "messages") continue;
      const phoneNumberId = change.value.metadata.phone_number_id;
      const contacts = change.value.contacts ?? [];

      for (const message of change.value.messages ?? []) {
        events.push(toInboundEvent(phoneNumberId, message, contacts));
      }
      for (const status of change.value.statuses ?? []) {
        events.push(toStatusEvent(phoneNumberId, status));
      }
    }
  }

  return events;
}
