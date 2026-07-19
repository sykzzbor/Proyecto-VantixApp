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
      "1 agente de IA",
      "Hasta 350 conversaciones por mes",
      "1 conexión de WhatsApp API",
      "Integración con Excel, Google Sheets y Google Calendar",
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
      "Automatizaciones y seguimientos automáticos",
      "Gestión completa de turnos con Google Calendar",
      "Métricas avanzadas",
      "Roles y gestión de equipo",
    ],
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Empresarial",
    usdMonthly: 350,
    description: "Mayor capacidad y acompañamiento para operaciones consolidadas.",
    recommended: false,
    features: [
      "Todo lo incluido en Profesional",
      "Mayor capacidad operativa",
      "Flujos e integraciones avanzadas",
      "Acompañamiento de implementación",
      "Soporte prioritario",
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
