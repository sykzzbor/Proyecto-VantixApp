import { prisma } from "@/lib/prisma";
import {
  BILLING_PLANS,
  resolvePlanRules,
  type PlanFeature,
  type PlanLimits,
  type PlanRules,
} from "@/lib/billing/plans";
import {
  getOrganizationEntitlement,
  requireActiveSubscription,
  SubscriptionRequiredError,
  type OrganizationEntitlement,
} from "@/server/billing/entitlement";
import { ActionError } from "@/server/errors";

/**
 * Guards centrales de plan. Todo se valida en servidor: el frontend puede
 * ocultar botones, pero la última palabra la tienen estas funciones.
 */

export class PlanFeatureError extends ActionError {
  readonly code = "plan_feature_required";

  constructor(feature: PlanFeature) {
    super(FEATURE_MESSAGES[feature]);
    this.name = "PlanFeatureError";
  }
}

export class UsageLimitError extends ActionError {
  readonly code = "usage_limit_reached";

  constructor(
    readonly metric: UsageMetric,
    readonly limit: number
  ) {
    super(
      metric === "conversations"
        ? `Alcanzaste el límite de ${limit.toLocaleString("es-AR")} conversaciones de este mes. Mejorá tu plan para seguir atendiendo conversaciones nuevas.`
        : `Alcanzaste el límite de ${limit.toLocaleString("es-AR")} respuestas de IA de este mes. Mejorá tu plan para que el agente siga respondiendo.`
    );
    this.name = "UsageLimitError";
  }
}

const FEATURE_MESSAGES: Record<PlanFeature, string> = {
  whatsapp: "Tu plan no incluye WhatsApp.",
  test_chat: "Tu plan no incluye el chat de prueba.",
  crm: "Tu plan no incluye el CRM.",
  knowledge: "Tu plan no incluye la base de conocimiento.",
  google_calendar:
    "Google Calendar no está disponible durante la prueba. Elegí un plan para conectar tu agenda.",
  google_sheets:
    "Google Sheets no está disponible durante la prueba. Elegí un plan para conectarlo.",
  basic_automations: "Tu plan no incluye automatizaciones.",
  advanced_automations:
    "Las automatizaciones avanzadas están disponibles desde el plan Profesional.",
  advanced_metrics:
    "Las métricas avanzadas están disponibles desde el plan Profesional.",
  roles_audit:
    "Los roles avanzados y la auditoría están disponibles desde el plan Profesional.",
  tiendanube: "Tiendanube está disponible desde el plan Profesional.",
  woocommerce: "WooCommerce está disponible desde el plan Profesional.",
  custom_integrations:
    "Las integraciones personalizadas están disponibles en el plan Empresarial.",
  multi_whatsapp:
    "Varias líneas de WhatsApp están disponibles en el plan Empresarial.",
  priority_support:
    "El soporte prioritario está disponible en el plan Empresarial.",
};

/** Reglas efectivas (límites + funciones) para un entitlement ya evaluado. */
export function getPlanRules(entitlement: OrganizationEntitlement): PlanRules {
  if (entitlement.internalPlanTest) {
    const plan = BILLING_PLANS[entitlement.plan];
    return { limits: plan.limits, features: plan.featureSet };
  }
  return resolvePlanRules(entitlement.plan, entitlement.status);
}

export function hasPlanFeature(
  entitlement: OrganizationEntitlement,
  feature: PlanFeature
): boolean {
  return getPlanRules(entitlement).features.has(feature);
}

/**
 * Suscripción vigente o SubscriptionRequiredError. Es el nombre canónico del
 * guard; `requireActiveSubscription` queda como alias histórico.
 */
export async function requireActiveEntitlement(
  organizationId: string,
  now = new Date()
): Promise<OrganizationEntitlement> {
  return requireActiveSubscription(organizationId, now);
}

/**
 * Suscripción vigente Y función incluida en el plan (o en la prueba).
 * Lanza SubscriptionRequiredError o PlanFeatureError según corresponda.
 */
export async function requirePlanFeature(
  organizationId: string,
  feature: PlanFeature,
  now = new Date()
): Promise<OrganizationEntitlement> {
  const entitlement = await requireActiveEntitlement(organizationId, now);
  if (!hasPlanFeature(entitlement, feature)) {
    throw new PlanFeatureError(feature);
  }
  return entitlement;
}

// ============================================================
// Contadores mensuales de uso
// ============================================================

export type UsageMetric = "conversations" | "aiResponses";

/** Clave de período mensual en UTC: los contadores se reinician por mes. */
export function usagePeriodKey(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function usageLimitFor(limits: PlanLimits, metric: UsageMetric): number {
  return metric === "conversations"
    ? limits.conversationsPerMonth
    : limits.aiResponsesPerMonth;
}

type UsageRow = { conversationsCount: number; aiResponsesCount: number };

/** Almacenamiento inyectable para probar los límites sin base de datos. */
export type UsageStore = {
  read(organizationId: string, periodKey: string): Promise<UsageRow | null>;
  /**
   * Incremento condicional y atómico: suma `amount` solo si el contador sigue
   * por debajo de `limit`. Devuelve cuántas filas actualizó (0 = límite).
   */
  incrementIfBelow(input: {
    organizationId: string;
    periodKey: string;
    metric: UsageMetric;
    amount: number;
    limit: number;
  }): Promise<number>;
  decrement(input: {
    organizationId: string;
    periodKey: string;
    metric: UsageMetric;
    amount: number;
  }): Promise<void>;
};

const COLUMN: Record<UsageMetric, "conversationsCount" | "aiResponsesCount"> = {
  conversations: "conversationsCount",
  aiResponses: "aiResponsesCount",
};

const defaultUsageStore: UsageStore = {
  async read(organizationId, periodKey) {
    return prisma.organizationUsagePeriod.findUnique({
      where: { organizationId_periodKey: { organizationId, periodKey } },
      select: { conversationsCount: true, aiResponsesCount: true },
    });
  },
  async incrementIfBelow({ organizationId, periodKey, metric, amount, limit }) {
    const column = COLUMN[metric];
    // La fila del período se crea al primer uso del mes: eso ES el reinicio,
    // sin tocar los meses anteriores.
    await prisma.organizationUsagePeriod.upsert({
      where: { organizationId_periodKey: { organizationId, periodKey } },
      create: { organizationId, periodKey },
      update: {},
    });
    const updated = await prisma.organizationUsagePeriod.updateMany({
      where: { organizationId, periodKey, [column]: { lte: limit - amount } },
      data: { [column]: { increment: amount } },
    });
    return updated.count;
  },
  async decrement({ organizationId, periodKey, metric, amount }) {
    const column = COLUMN[metric];
    await prisma.organizationUsagePeriod.updateMany({
      where: { organizationId, periodKey, [column]: { gte: amount } },
      data: { [column]: { decrement: amount } },
    });
  },
};

export type ConsumeUsageResult =
  | { allowed: true; remaining: number; limit: number }
  | { allowed: false; used: number; limit: number };

/**
 * Reserva `amount` unidades del período actual de forma atómica. Falla cerrado:
 * si el contador llegó al límite del plan (o de la prueba), no incrementa y
 * devuelve `allowed: false`. Con `strict` lanza UsageLimitError directamente.
 */
export async function consumeUsage(
  input: {
    organizationId: string;
    metric: UsageMetric;
    amount?: number;
    entitlement?: OrganizationEntitlement;
    now?: Date;
    strict?: boolean;
  },
  store: UsageStore = defaultUsageStore
): Promise<ConsumeUsageResult> {
  const now = input.now ?? new Date();
  const amount = input.amount ?? 1;
  const entitlement =
    input.entitlement ?? (await getOrganizationEntitlement(input.organizationId, now));
  if (!entitlement.accessAllowed) throw new SubscriptionRequiredError();

  const limit = usageLimitFor(getPlanRules(entitlement).limits, input.metric);
  const periodKey = usagePeriodKey(now);
  const updated = await store.incrementIfBelow({
    organizationId: input.organizationId,
    periodKey,
    metric: input.metric,
    amount,
    limit,
  });

  if (updated === 0) {
    if (input.strict) throw new UsageLimitError(input.metric, limit);
    const row = await store.read(input.organizationId, periodKey);
    const used = row ? row[COLUMN[input.metric]] : limit;
    return { allowed: false, used, limit };
  }

  const row = await store.read(input.organizationId, periodKey);
  const used = row ? row[COLUMN[input.metric]] : amount;
  return { allowed: true, remaining: Math.max(0, limit - used), limit };
}

/**
 * Devuelve unidades reservadas cuando la operación posterior falló (por
 * ejemplo, el proveedor de IA dio error): el fallo no debe consumir cupo.
 */
export async function refundUsage(
  input: {
    organizationId: string;
    metric: UsageMetric;
    amount?: number;
    now?: Date;
  },
  store: UsageStore = defaultUsageStore
): Promise<void> {
  await store.decrement({
    organizationId: input.organizationId,
    periodKey: usagePeriodKey(input.now ?? new Date()),
    metric: input.metric,
    amount: input.amount ?? 1,
  });
}

/** Lectura del uso del período (para pantallas y logs; nunca lanza). */
export async function getUsageSnapshot(
  organizationId: string,
  now = new Date(),
  store: UsageStore = defaultUsageStore
): Promise<{ periodKey: string; conversations: number; aiResponses: number }> {
  const periodKey = usagePeriodKey(now);
  const row = await store.read(organizationId, periodKey);
  return {
    periodKey,
    conversations: row?.conversationsCount ?? 0,
    aiResponses: row?.aiResponsesCount ?? 0,
  };
}

// ============================================================
// Límites de estructura: usuarios por negocio y negocios por cuenta
// ============================================================

/**
 * Valida en servidor que la organización pueda sumar un miembro más. Cuenta
 * miembros actuales + invitaciones pendientes para que no se pueda superar el
 * cupo invitando en paralelo.
 */
export async function assertCanAddMember(
  organizationId: string,
  options: {
    entitlement?: OrganizationEntitlement;
    /**
     * Al invitar se cuentan también las invitaciones pendientes (reservan
     * cupo); al aceptar una invitación ya emitida solo cuentan los miembros.
     */
    includePending?: boolean;
    now?: Date;
  } = {}
): Promise<void> {
  const now = options.now ?? new Date();
  const resolved =
    options.entitlement ?? (await requireActiveEntitlement(organizationId, now));
  const limit = getPlanRules(resolved).limits.users;
  const includePending = options.includePending ?? true;
  const [members, pendingInvitations] = await Promise.all([
    prisma.organizationMember.count({ where: { organizationId } }),
    includePending
      ? prisma.invitation.count({
          where: {
            organizationId,
            status: "PENDING",
            expiresAt: { gt: now },
          },
        })
      : Promise.resolve(0),
  ]);
  if (members + pendingInvitations >= limit) {
    throw new ActionError(
      resolved.status === "TRIALING"
        ? "Durante la prueba el equipo es de 1 usuario. Elegí un plan para invitar a más personas."
        : `Tu plan admite hasta ${limit} usuarios por negocio. Mejorá el plan para sumar más personas.`
    );
  }
}

/** Cantidad de negocios que el plan/prueba permite por cuenta. */
export function businessLimitFor(entitlement: OrganizationEntitlement): number {
  return getPlanRules(entitlement).limits.businesses;
}
