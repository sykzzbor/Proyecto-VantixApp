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
  phoneNumberId: string;
  externalMessageId: string;
  from: string;
  customerName: string;
  timestamp: string | null;
  messageType: WhatsappMessageType;
  content: string;
  metadata: Record<string, unknown>;
};

export type WhatsappStatusEvent = {
  kind: "status";
  phoneNumberId: string;
  externalMessageId: string;
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
  phoneNumberId: string;
  displayPhoneNumber: string;
  encryptedAccessToken: string;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
};
