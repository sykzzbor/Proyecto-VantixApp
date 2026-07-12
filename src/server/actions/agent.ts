"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  agentSettingsSchema,
  type AgentSettingsInput,
} from "@/lib/validations/agent";
import { recordAudit } from "@/server/audit";
import { getOrgContext, requirePermission } from "@/server/context";
import { closeTestConversation } from "@/server/conversations";
import { toActionFailure, type ActionResult } from "@/server/errors";

export async function saveAgentSettings(
  input: AgentSettingsInput
): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "agent.update");
    const data = agentSettingsSchema.parse(input);

    const values = {
      assistantName: data.assistantName,
      tone: data.tone,
      welcomeMessage: data.welcomeMessage,
      fallbackMessage: data.fallbackMessage,
      handoffRules: data.handoffRules || null,
      enabled: data.enabled,
    };

    await prisma.agentSettings.upsert({
      where: { organizationId: org.id },
      create: { organizationId: org.id, ...values },
      update: values,
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: data.enabled ? "agente.configurado_activo" : "agente.configurado_inactivo",
      entityType: "agent_settings",
      details: { nombre: data.assistantName },
    });

    revalidatePath("/dashboard/agente");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * Cierra la conversación de prueba actual. El historial queda guardado
 * en la base; el chat del dashboard arranca vacío.
 */
export async function clearTestConversation(): Promise<ActionResult> {
  try {
    const { user, org } = await getOrgContext();

    await closeTestConversation(org.id);

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "agente.conversacion_reiniciada",
      entityType: "conversation",
    });

    revalidatePath("/dashboard/agente");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
