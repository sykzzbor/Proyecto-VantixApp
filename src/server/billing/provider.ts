import type { BillingPlanId } from "@/lib/billing/plans";

export type BillingProviderSubscription = {
  id: string;
  status: "pending" | "authorized" | "paused" | "cancelled";
  externalReference: string | null;
  payerId: string | null;
  amountArs: number | null;
  currency: string | null;
  nextPaymentAt: Date | null;
  startedAt: Date | null;
  lastModifiedAt: Date | null;
};

export type CreateBillingSubscriptionInput = {
  plan: BillingPlanId;
  payerEmail: string;
  externalReference: string;
  amountArs: number;
  returnUrl: string;
};

export type CreatedBillingSubscription = BillingProviderSubscription & {
  checkoutUrl: string;
};

export type BillingAuthorizedPayment = {
  id: string;
  subscriptionId: string;
  paymentStatus: "approved" | "rejected" | "pending";
  amountArs: number;
  currency: string;
  lastModifiedAt: Date | null;
};

export interface BillingProvider {
  readonly name: "MERCADO_PAGO";
  createSubscription(
    input: CreateBillingSubscriptionInput
  ): Promise<CreatedBillingSubscription>;
  getSubscription(externalSubscriptionId: string): Promise<BillingProviderSubscription>;
  getAuthorizedPayment(externalPaymentId: string): Promise<BillingAuthorizedPayment>;
  cancelSubscription(externalSubscriptionId: string): Promise<BillingProviderSubscription>;
}

export class BillingProviderError extends Error {
  constructor(
    readonly code:
      | "not_configured"
      | "provider_unavailable"
      | "provider_rejected"
      | "amount_mismatch"
      | "invalid_provider_response",
    readonly safeMessage: string
  ) {
    super(safeMessage);
    this.name = "BillingProviderError";
  }
}
