import { z } from "zod";

export const BILLING_PLAN_IDS = [
  "STANDARD",
  "PROFESSIONAL",
  "ENTERPRISE",
] as const;

export const billingPlanSchema = z.enum(BILLING_PLAN_IDS);
export type BillingPlanId = z.infer<typeof billingPlanSchema>;

/**
 * Funciones habilitables por plan. La validación es SIEMPRE en servidor:
 * ocultar botones no alcanza. Tiendanube, WooCommerce y Sheets todavía no
 * tienen integración construida, pero el permiso queda tipado acá para que el
 * guard exista desde el día uno.
 */
export const PLAN_FEATURES = [
  "whatsapp",
  "test_chat",
  "crm",
  "knowledge",
  "google_calendar",
  "google_sheets",
  "basic_automations",
  "advanced_automations",
  "advanced_metrics",
  "roles_audit",
  "tiendanube",
  "woocommerce",
  "custom_integrations",
  "multi_whatsapp",
  "priority_support",
] as const;

export type PlanFeature = (typeof PLAN_FEATURES)[number];

export type PlanLimits = {
  /** Negocios (organizaciones) por cuenta. */
  businesses: number;
  /** Usuarios (miembros) por negocio. */
  users: number;
  /** Conversaciones nuevas por mes calendario. */
  conversationsPerMonth: number;
  /** Respuestas generadas por la IA por mes calendario. */
  aiResponsesPerMonth: number;
};

export type PlanRules = {
  limits: PlanLimits;
  features: ReadonlySet<PlanFeature>;
};

export type BillingPlanDefinition = {
  id: BillingPlanId;
  name: string;
  usdMonthly: number;
  description: string;
  recommended: boolean;
  /** Bullets de la página de planes (marketing, no enforcement). */
  features: readonly string[];
  limits: PlanLimits;
  /** Funciones habilitadas (enforcement real, validado en servidor). */
  featureSet: ReadonlySet<PlanFeature>;
};

const STANDARD_FEATURES: ReadonlySet<PlanFeature> = new Set<PlanFeature>([
  "whatsapp",
  "test_chat",
  "crm",
  "knowledge",
  "google_calendar",
  "google_sheets",
  "basic_automations",
]);

const PROFESSIONAL_FEATURES: ReadonlySet<PlanFeature> = new Set<PlanFeature>([
  ...STANDARD_FEATURES,
  "tiendanube",
  "woocommerce",
  "advanced_automations",
  "advanced_metrics",
  "roles_audit",
]);

const ENTERPRISE_FEATURES: ReadonlySet<PlanFeature> = new Set<PlanFeature>(
  PLAN_FEATURES
);

export const BILLING_PLANS = {
  STANDARD: {
    id: "STANDARD",
    name: "Standard",
    usdMonthly: 89,
    description: "La base operativa para centralizar la atención de un negocio.",
    recommended: false,
    features: [
      "1 negocio y 3 usuarios",
      "1.000 conversaciones mensuales",
      "5.000 respuestas de IA por mes",
      "WhatsApp, Google Calendar y Google Sheets",
      "CRM y conocimiento completos",
      "Automatizaciones básicas",
    ],
    limits: {
      businesses: 1,
      users: 3,
      conversationsPerMonth: 1_000,
      aiResponsesPerMonth: 5_000,
    },
    featureSet: STANDARD_FEATURES,
  },
  PROFESSIONAL: {
    id: "PROFESSIONAL",
    name: "Profesional",
    usdMonthly: 179,
    description: "Para equipos que necesitan automatización, agenda y mayor control.",
    recommended: true,
    features: [
      "Todo lo incluido en Standard",
      "3 negocios y 10 usuarios",
      "5.000 conversaciones mensuales",
      "25.000 respuestas de IA por mes",
      "Tiendanube y WooCommerce",
      "Automatizaciones y métricas avanzadas",
      "Roles y auditoría",
    ],
    limits: {
      businesses: 3,
      users: 10,
      conversationsPerMonth: 5_000,
      aiResponsesPerMonth: 25_000,
    },
    featureSet: PROFESSIONAL_FEATURES,
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Empresarial",
    usdMonthly: 349,
    description: "Mayor capacidad y acompañamiento para operaciones consolidadas.",
    recommended: false,
    features: [
      "Todo lo incluido en Profesional",
      "10 negocios y 30 usuarios",
      "20.000 conversaciones mensuales",
      "100.000 respuestas de IA por mes",
      "Todas las integraciones e integraciones personalizadas",
      "Varias líneas de WhatsApp",
      "Soporte prioritario",
    ],
    limits: {
      businesses: 10,
      users: 30,
      conversationsPerMonth: 20_000,
      aiResponsesPerMonth: 100_000,
    },
    featureSet: ENTERPRISE_FEATURES,
  },
} as const satisfies Record<BillingPlanId, BillingPlanDefinition>;

/**
 * Reglas vigentes durante la prueba de 5 días, más restrictivas que cualquier
 * plan: 1 negocio, 1 usuario, 50 conversaciones, 300 respuestas de IA, y solo
 * WhatsApp + chat de prueba (sin Calendar, Sheets, Tiendanube ni WooCommerce).
 */
export const TRIAL_RULES: PlanRules = {
  limits: {
    businesses: 1,
    users: 1,
    conversationsPerMonth: 50,
    aiResponsesPerMonth: 300,
  },
  features: new Set<PlanFeature>([
    "whatsapp",
    "test_chat",
    "crm",
    "knowledge",
    "basic_automations",
  ]),
};

export const BILLING_PLAN_LIST = BILLING_PLAN_IDS.map(
  (planId) => BILLING_PLANS[planId]
);

export function getBillingPlan(planId: BillingPlanId): BillingPlanDefinition {
  return BILLING_PLANS[planId];
}

export function isBillingPlanId(value: string): value is BillingPlanId {
  return BILLING_PLAN_IDS.includes(value as BillingPlanId);
}

/**
 * Reglas efectivas según el estado de la suscripción: durante la prueba rigen
 * los topes de la prueba; con plan contratado, los del plan.
 */
export function resolvePlanRules(
  planId: BillingPlanId,
  status: string
): PlanRules {
  if (status === "TRIALING") return TRIAL_RULES;
  const plan = BILLING_PLANS[planId];
  return { limits: plan.limits, features: plan.featureSet };
}

export function planHasFeature(
  planId: BillingPlanId,
  status: string,
  feature: PlanFeature
): boolean {
  return resolvePlanRules(planId, status).features.has(feature);
}
