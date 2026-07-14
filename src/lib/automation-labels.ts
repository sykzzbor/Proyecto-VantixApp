const EVENT_TYPE_LABELS: Record<string, string> = {
  "conversation.handoff_requested": "Derivación humana",
  "conversation.followup_due": "Seguimiento automático",
  "conversation.closed": "Conversación cerrada",
  "customer.created": "Cliente creado",
  "whatsapp.message_failed": "Mensaje de WhatsApp fallido",
  "knowledge.document_failed": "Documento con error",
  "ai.provider_failed": "Proveedor de IA con error",
  "automation.test": "Prueba de automatización",
};

export function automationEventTypeLabel(type: string) {
  return EVENT_TYPE_LABELS[type] ?? type;
}
