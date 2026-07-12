import { prisma } from "@/lib/prisma";

type AuditInput = {
  organizationId: string;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
};

/**
 * Registra una acción importante en audit_logs. Un fallo de auditoría
 * no debe romper la operación principal: se informa por consola.
 */
export async function recordAudit(input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        details: input.details ? JSON.parse(JSON.stringify(input.details)) : undefined,
      },
    });
  } catch (error) {
    console.error("[VantixApp] No se pudo registrar la auditoría:", error);
  }
}
