import type { BillingPlanId } from "@/lib/billing/plans";

/**
 * La prueba o una cuenta vencida nunca bloquean la contratación. El único
 * estado de suscripción que invalida un CTA de plan es estar ACTIVE en ese
 * mismo plan. Permisos y loading siguen siendo bloqueos de seguridad/UX.
 */
export function isPlanCheckoutDisabled(input: {
  targetPlan: BillingPlanId;
  currentPlan: BillingPlanId;
  subscriptionStatus: string;
  canManage: boolean;
  checkoutLoading: boolean;
}): boolean {
  return (
    !input.canManage ||
    input.checkoutLoading ||
    (input.subscriptionStatus === "ACTIVE" &&
      input.currentPlan === input.targetPlan)
  );
}

export function isCurrentActivePlan(input: {
  targetPlan: BillingPlanId;
  currentPlan: BillingPlanId;
  subscriptionStatus: string;
}): boolean {
  return (
    input.subscriptionStatus === "ACTIVE" &&
    input.currentPlan === input.targetPlan
  );
}
