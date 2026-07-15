import { prisma } from "@/lib/prisma";

type WhatsappIntegrationReader = Pick<typeof prisma, "whatsappIntegration">;

export type CurrentWhatsappIntegrationResolution =
  | { state: "none" }
  | { state: "ambiguous" }
  | { state: "current"; id: string; active: boolean };

/**
 * Selecciona la conexión vigente sin depender de `updatedAt`: los webhooks de
 * entrega pueden actualizar integraciones históricas mucho después de una
 * reconexión. Solo una conexión debería estar activa; priorizamos cualquier
 * estado vigente (incluidos ERROR/ACTION_REQUIRED) y usamos fechas funcionales
 * para el fallback histórico.
 */
export async function resolveCurrentWhatsappIntegration(
  organizationId: string,
  client: WhatsappIntegrationReader = prisma
): Promise<CurrentWhatsappIntegrationResolution> {
  const active = await client.whatsappIntegration.findMany({
    where: { organizationId, status: { not: "DISCONNECTED" } },
    orderBy: [
      { lastSyncedAt: { sort: "desc", nulls: "last" } },
      { connectedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    take: 2,
    select: { id: true },
  });
  if (active.length > 1) return { state: "ambiguous" };
  if (active[0]) {
    return { state: "current", id: active[0].id, active: true };
  }

  const latest = await client.whatsappIntegration.findFirst({
    where: { organizationId },
    orderBy: [
      { lastSyncedAt: { sort: "desc", nulls: "last" } },
      { connectedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: { id: true },
  });
  return latest
    ? { state: "current", id: latest.id, active: false }
    : { state: "none" };
}
