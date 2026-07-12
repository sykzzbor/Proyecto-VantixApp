import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/format";

export type WhatsappIntegrationView = {
  id: string;
  status: "connected" | "disconnected" | "error";
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  maskedAccessToken: string;
  connectedAtLabel: string | null;
  lastWebhookAtLabel: string | null;
  updatedAtLabel: string;
  lastError: string | null;
};

export async function getWhatsappIntegrationView(
  organizationId: string
): Promise<WhatsappIntegrationView | null> {
  const integration = await prisma.whatsappIntegration.findFirst({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      status: true,
      wabaId: true,
      phoneNumberId: true,
      displayPhoneNumber: true,
      verifiedName: true,
      connectedAt: true,
      lastWebhookAt: true,
      updatedAt: true,
      lastError: true,
    },
  });
  if (!integration) return null;

  return {
    id: integration.id,
    status: integration.status.toLowerCase() as WhatsappIntegrationView["status"],
    wabaId: integration.wabaId,
    phoneNumberId: integration.phoneNumberId,
    displayPhoneNumber: integration.displayPhoneNumber,
    verifiedName: integration.verifiedName,
    maskedAccessToken: "••••••••••••••••",
    connectedAtLabel: integration.connectedAt
      ? formatDateTime(integration.connectedAt)
      : null,
    lastWebhookAtLabel: integration.lastWebhookAt
      ? formatDateTime(integration.lastWebhookAt)
      : null,
    updatedAtLabel: formatDateTime(integration.updatedAt),
    lastError: integration.lastError,
  };
}
