"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  onboardingBusinessInfoSchema,
  onboardingScheduleSchema,
  type OnboardingBusinessInfoInput,
  type OnboardingScheduleInput,
} from "@/lib/validations/business";
import { recordAudit } from "@/server/audit";
import { toActionFailure, type ActionResult } from "@/server/errors";
import { getOnboardingActionContext } from "@/server/organizations/onboarding-context";
import {
  isOnboardingStep,
  ONBOARDING_STEP_DEFINITIONS,
} from "@/server/organizations/onboarding-progress";
import { consumeThrottle } from "@/server/auth/throttle";

/**
 * Acciones del onboarding guiado.
 *
 * Reglas comunes a todas:
 * - la organización sale de la sesión, nunca de la entrada del cliente;
 * - cada acción valida y escribe SOLO los campos de su paso;
 * - los errores se devuelven ya traducidos, sin detalle interno;
 * - queda auditoría sin datos sensibles.
 */

/** Evita que un bucle del cliente martille la base con autosaves. */
async function guardRate(organizationId: string): Promise<string | null> {
  const decision = await consumeThrottle(
    "onboarding-write",
    organizationId,
    { limit: 120, windowMs: 5 * 60 * 1000 }
  );
  if (decision.allowed) return null;
  return `Demasiados cambios seguidos. Probá de nuevo en ${decision.retryAfterSeconds} segundos.`;
}

export async function saveOnboardingBusinessInfo(
  input: OnboardingBusinessInfoInput
): Promise<ActionResult> {
  try {
    const { user, org } = await getOnboardingActionContext();

    const limited = await guardRate(org.id);
    if (limited) return { ok: false, error: limited };

    const data = onboardingBusinessInfoSchema.parse(input);
    const values = {
      description: data.description,
      industry: data.industry || null,
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
      city: data.city || null,
      country: data.country || null,
    };

    await prisma.businessProfile.upsert({
      where: { organizationId: org.id },
      // Si por algún motivo faltara el perfil, se crea con el nombre del negocio.
      create: { organizationId: org.id, name: org.name, ...values },
      update: values,
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "onboarding.informacion_guardada",
      entityType: "business_profile",
      // Sin contenido: solo qué campos quedaron cargados.
      details: {
        rubro: Boolean(values.industry),
        telefono: Boolean(values.phone),
        email: Boolean(values.email),
        direccion: Boolean(values.address),
      },
    });

    revalidatePath("/onboarding/informacion");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function saveOnboardingSchedule(
  input: OnboardingScheduleInput
): Promise<ActionResult> {
  try {
    const { user, org } = await getOnboardingActionContext();

    const limited = await guardRate(org.id);
    if (limited) return { ok: false, error: limited };

    const data = onboardingScheduleSchema.parse(input);

    await prisma.businessProfile.upsert({
      where: { organizationId: org.id },
      create: {
        organizationId: org.id,
        name: org.name,
        openingHours: data.openingHours,
        timeZone: data.timeZone,
      },
      update: { openingHours: data.openingHours, timeZone: data.timeZone },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "onboarding.horarios_guardados",
      entityType: "business_profile",
      details: { zonaHoraria: data.timeZone },
    });

    revalidatePath("/onboarding/horarios");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Marca un paso OPCIONAL como omitido. Los obligatorios se rechazan. */
export async function skipOnboardingStep(step: string): Promise<ActionResult> {
  try {
    const { user, org } = await getOnboardingActionContext();

    if (!isOnboardingStep(step)) {
      return { ok: false, error: "Ese paso no existe." };
    }
    const definition = ONBOARDING_STEP_DEFINITIONS.find(
      (item) => item.step === step
    );
    if (!definition?.optional) {
      return { ok: false, error: "Este paso no se puede omitir." };
    }

    const current = await prisma.organizationOnboarding.findUnique({
      where: { organizationId: org.id },
      select: { skippedSteps: true },
    });
    if (!current) return { ok: false, error: "No encontramos tu onboarding." };

    if (!current.skippedSteps.includes(step)) {
      await prisma.organizationOnboarding.update({
        where: { organizationId: org.id },
        data: { skippedSteps: { set: [...current.skippedSteps, step] } },
      });
    }

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "onboarding.paso_omitido",
      entityType: "organization_onboarding",
      details: { paso: step },
    });

    revalidatePath("/onboarding");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Guarda en qué paso quedó la persona, para retomar donde dejó. */
export async function rememberOnboardingStep(step: string): Promise<ActionResult> {
  try {
    const { org } = await getOnboardingActionContext();
    if (!isOnboardingStep(step)) {
      return { ok: false, error: "Ese paso no existe." };
    }

    await prisma.organizationOnboarding.updateMany({
      where: { organizationId: org.id, completedAt: null },
      data: { lastStep: step },
    });
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * Registra que se probó el agente de verdad. La llama el propio flujo de
 * prueba después de recibir una respuesta, no el botón de "siguiente".
 */
export async function markAgentTested(): Promise<ActionResult> {
  try {
    const { org } = await getOnboardingActionContext();

    await prisma.organizationOnboarding.updateMany({
      where: { organizationId: org.id, agentTestedAt: null },
      data: { agentTestedAt: new Date() },
    });

    revalidatePath("/onboarding/prueba");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * Finaliza el onboarding. Vuelve a leer el estado del servidor: aunque el
 * cliente muestre el botón habilitado, si falta un paso obligatorio se rechaza.
 */
export async function completeOnboarding(): Promise<ActionResult> {
  try {
    const { user, org, state } = await getOnboardingActionContext();

    if (state.isComplete) return { ok: true };
    if (!state.canFinish) {
      return {
        ok: false,
        error: "Todavía falta completar algún paso obligatorio.",
      };
    }

    const now = new Date();
    await prisma.organizationOnboarding.updateMany({
      where: { organizationId: org.id, completedAt: null },
      data: { completedAt: now, lastStep: "finalizar" },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "onboarding.finalizado",
      entityType: "organization_onboarding",
      entityId: org.id,
    });

    revalidatePath("/dashboard");
    revalidatePath("/onboarding");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
