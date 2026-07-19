import { z } from "zod";

export const BILLING_PLAN_IDS = [
  "STANDARD",
  "PROFESSIONAL",
  "ENTERPRISE",
] as const;

export const billingPlanSchema = z.enum(BILLING_PLAN_IDS);
export type BillingPlanId = z.infer<typeof billingPlanSchema>;

export type BillingPlanDefinition = {
  id: BillingPlanId;
  name: string;
  usdMonthly: number;
  description: string;
  recommended: boolean;
  features: readonly string[];
};

export const BILLING_PLANS = {
  STANDARD: {
    id: "STANDARD",
    name: "Standard",
    usdMonthly: 90,
    description: "La base operativa para centralizar la atención de un negocio.",
    recommended: false,
    features: [
      "Panel comercial",
      "Conversaciones centralizadas",
      "Agente IA",
      "Base de conocimiento",
    ],
  },
  PROFESSIONAL: {
    id: "PROFESSIONAL",
    name: "Profesional",
    usdMonthly: 179,
    description: "Para equipos que necesitan automatización, agenda y mayor control.",
    recommended: true,
    features: [
      "Todo lo incluido en Standard",
      "Automatizaciones operativas",
      "Google Calendar y turnos",
      "Métricas avanzadas",
    ],
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Empresarial",
    usdMonthly: 400,
    description: "Mayor capacidad y acompañamiento para operaciones consolidadas.",
    recommended: false,
    features: [
      "Todo lo incluido en Profesional",
      "Mayor capacidad operativa",
      "Integraciones evaluadas",
      "Soporte coordinado",
    ],
  },
} as const satisfies Record<BillingPlanId, BillingPlanDefinition>;

export const BILLING_PLAN_LIST = BILLING_PLAN_IDS.map(
  (planId) => BILLING_PLANS[planId]
);

export function getBillingPlan(planId: BillingPlanId): BillingPlanDefinition {
  return BILLING_PLANS[planId];
}

export function isBillingPlanId(value: string): value is BillingPlanId {
  return BILLING_PLAN_IDS.includes(value as BillingPlanId);
}
