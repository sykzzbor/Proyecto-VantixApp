import type { WhatsappDeliveryStatus } from "@/server/whatsapp/types";

const STATUS_RANK: Record<Exclude<WhatsappDeliveryStatus, "FAILED">, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
};

/**
 * Meta no garantiza que los webhooks de estado lleguen ordenados. Esta
 * transición evita retrocesos y conserva FAILED como estado terminal del
 * intento. Un reintento crea un mensaje nuevo con otro ID externo.
 */
export function nextDeliveryStatus(
  current: WhatsappDeliveryStatus | null,
  incoming: Exclude<WhatsappDeliveryStatus, "PENDING">
): WhatsappDeliveryStatus {
  if (current === "FAILED") return current;
  if (incoming === "FAILED") {
    return current === "DELIVERED" || current === "READ" ? current : "FAILED";
  }
  if (!current) return incoming;
  return STATUS_RANK[incoming] >= STATUS_RANK[current] ? incoming : current;
}

export function isDeliveryFailure(status: WhatsappDeliveryStatus | null) {
  return status === "FAILED";
}
