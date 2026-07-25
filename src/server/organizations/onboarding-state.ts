import { prisma } from "@/lib/prisma";
import {
  buildOnboardingState,
  type OnboardingSignals,
  type OnboardingState,
  type OnboardingStep,
} from "@/server/organizations/onboarding-progress";

/**
 * Lee de la base las señales del onboarding y arma el estado.
 *
 * Todas las consultas van filtradas por `organizationId`, que siempre llega
 * resuelto desde la sesión (ver `getOrgContext`). Ninguna acepta un id que
 * venga del navegador.
 */

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Las organizaciones creadas antes de esta función no tienen fila de
 * onboarding. Meterlas de nuevo al asistente sería una regresión para gente
 * que ya está operando, así que se las considera finalizadas al leerlas por
 * primera vez, con la fecha de creación de la organización.
 */
async function ensureOnboardingRow(organizationId: string) {
  const existing = await prisma.organizationOnboarding.findUnique({
    where: { organizationId },
    select: {
      startedAt: true,
      completedAt: true,
      lastStep: true,
      skippedSteps: true,
      agentTestedAt: true,
    },
  });
  if (existing) return existing;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { createdAt: true },
  });
  if (!organization) return null;

  return prisma.organizationOnboarding.upsert({
    where: { organizationId },
    create: {
      organizationId,
      startedAt: organization.createdAt,
      completedAt: organization.createdAt,
      lastStep: "finalizar",
    },
    update: {},
    select: {
      startedAt: true,
      completedAt: true,
      lastStep: true,
      skippedSteps: true,
      agentTestedAt: true,
    },
  });
}

export async function readOnboardingSignals(
  organizationId: string
): Promise<OnboardingSignals | null> {
  const record = await ensureOnboardingRow(organizationId);
  if (!record) return null;

  const [
    profile,
    products,
    services,
    faqs,
    knowledgeDocuments,
    whatsapp,
    googleCalendar,
    googleSheets,
    tiendanube,
    wooCommerce,
    aiUsage,
  ] = await Promise.all([
    prisma.businessProfile.findUnique({
      where: { organizationId },
      select: {
        description: true,
        phone: true,
        email: true,
        address: true,
        openingHours: true,
        timeZone: true,
      },
    }),
    prisma.product.count({ where: { organizationId } }),
    prisma.service.count({ where: { organizationId } }),
    prisma.faq.count({ where: { organizationId } }),
    prisma.knowledgeDocument.count({ where: { organizationId } }),
    prisma.whatsappIntegration.count({
      where: { organizationId, status: "CONNECTED" },
    }),
    prisma.googleCalendarConnection.count({
      where: { organizationId, status: "CONNECTED" },
    }),
    prisma.googleSheetsConnection.count({
      where: { organizationId, status: "CONNECTED" },
    }),
    prisma.tiendanubeConnection.count({
      where: { organizationId, status: "CONNECTED" },
    }),
    prisma.wooCommerceConnection.count({
      where: { organizationId, status: "CONNECTED" },
    }),
    // Señal real de "probé el agente": hubo al menos una respuesta del modelo.
    prisma.aiUsageEvent.count({ where: { organizationId, success: true } }),
  ]);

  return {
    organizationExists: true,
    profile: {
      hasDescription: hasText(profile?.description),
      hasContact:
        hasText(profile?.phone) ||
        hasText(profile?.email) ||
        hasText(profile?.address),
      hasOpeningHours: hasText(profile?.openingHours),
      hasTimeZone: hasText(profile?.timeZone),
    },
    counts: { products, services, faqs, knowledgeDocuments },
    hasConnectedIntegration:
      whatsapp + googleCalendar + googleSheets + tiendanube + wooCommerce > 0,
    agentTested: record.agentTestedAt !== null || aiUsage > 0,
    completedAt: record.completedAt,
    skippedSteps: record.skippedSteps,
  };
}

export async function getOnboardingState(
  organizationId: string
): Promise<OnboardingState | null> {
  const signals = await readOnboardingSignals(organizationId);
  return signals ? buildOnboardingState(signals) : null;
}

/** Guarda el último paso abierto para poder retomar donde se dejó. */
export async function rememberLastStep(
  organizationId: string,
  step: OnboardingStep
): Promise<void> {
  await prisma.organizationOnboarding.updateMany({
    where: { organizationId, completedAt: null },
    data: { lastStep: step },
  });
}
