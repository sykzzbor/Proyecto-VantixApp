import { createHash } from "node:crypto";
import type { SubscriptionStatusValue } from "@/server/billing/entitlement";
import type { BillingProviderSubscription } from "@/server/billing/provider";

export function resolveMercadoPagoStatus(input: {
  remote: BillingProviderSubscription;
  currentStatus: SubscriptionStatusValue;
  trialEndsAt: Date;
  now: Date;
  eventType?: string;
}): SubscriptionStatusValue {
  const eventType = input.eventType?.toLowerCase() ?? "";
  if (eventType.includes("rejected")) return "PAST_DUE";
  if (input.remote.status === "authorized") return "ACTIVE";
  if (input.remote.status === "paused") return "PAST_DUE";
  if (input.remote.status === "cancelled") return "CANCELED";
  if (
    input.currentStatus === "TRIALING" &&
    input.trialEndsAt.getTime() > input.now.getTime()
  ) {
    return "TRIALING";
  }
  return "INCOMPLETE";
}

export function buildBillingWebhookIdempotencyKey(input: {
  provider: "MERCADO_PAGO";
  eventType: string;
  remote: BillingProviderSubscription;
  externalEventId?: string;
}): string {
  const independentNotification =
    input.externalEventId && input.externalEventId !== input.remote.id;
  const version = independentNotification
    ? "notification"
    : input.remote.lastModifiedAt?.toISOString() ??
      `${input.remote.status}:${input.remote.nextPaymentAt?.toISOString() ?? "none"}`;
  return createHash("sha256")
    .update(
      `${input.provider}:${input.eventType}:${input.externalEventId ?? input.remote.id}:${input.remote.id}:${version}`,
      "utf8"
    )
    .digest("hex");
}

export function sanitizeBillingErrorCode(value: unknown): string {
  if (!value || typeof value !== "object") return "billing_error";
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && /^[a-z_]{1,50}$/.test(code)
    ? code
    : "billing_error";
}
