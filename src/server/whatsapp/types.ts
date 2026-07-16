export type WhatsappMessageType =
  | "text"
  | "audio"
  | "image"
  | "document"
  | "sticker"
  | "location"
  | "video"
  | "interactive"
  | "button"
  | "reaction"
  | "unknown";

export type WhatsappDeliveryStatus =
  | "PENDING"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED";

export type WhatsappInboundEvent = {
  kind: "message";
  provider?: "META_CLOUD" | "YCLOUD";
  webhookEventId?: string;
  wabaId?: string;
  phoneNumberId: string;
  externalMessageId: string;
  whatsappMessageId?: string | null;
  from: string;
  customerName: string;
  timestamp: string | null;
  messageType: WhatsappMessageType;
  content: string;
  metadata: Record<string, unknown>;
};

export type WhatsappStatusEvent = {
  kind: "status";
  provider?: "META_CLOUD" | "YCLOUD";
  webhookEventId?: string;
  wabaId?: string;
  phoneNumberId: string;
  externalMessageId: string;
  whatsappMessageId?: string | null;
  internalMessageId?: string | null;
  timestamp: string | null;
  deliveryStatus: Exclude<WhatsappDeliveryStatus, "PENDING">;
  errorCode: string | null;
  errorMessage: string | null;
};

export type WhatsappWebhookEvent =
  | WhatsappInboundEvent
  | WhatsappStatusEvent;

export type ResolvedWhatsappIntegration = {
  id: string;
  organizationId: string;
  provider: "META_CLOUD" | "YCLOUD";
  wabaId: string;
  phoneNumberId: string;
  providerPhoneNumber: string | null;
  displayPhoneNumber: string;
  encryptedAccessToken: string;
  status:
    | "CONNECTING"
    | "CONNECTED"
    | "ACTION_REQUIRED"
    | "DISCONNECTED"
    | "ERROR";
};
