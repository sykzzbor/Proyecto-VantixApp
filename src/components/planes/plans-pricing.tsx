"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  CircleAlert,
  Loader2,
  Sparkles,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  convertUsdToArs,
  type PlansExchangeRate,
} from "@/lib/plans-pricing";
import {
  BILLING_PLAN_LIST,
  type BillingPlanId,
} from "@/lib/billing/plans";
import type { BillingOverview } from "@/server/billing/service";
import { isPlanCheckoutDisabled } from "@/lib/billing/checkout";

type Currency = "USD" | "ARS";

const PLAN_ICONS = {
  STANDARD: Zap,
  PROFESSIONAL: Sparkles,
  ENTERPRISE: Building2,
} as const;

const STATUS_LABELS = {
  TRIALING: "Prueba gratuita",
  ACTIVE: "Activa",
  PAST_DUE: "Pago pendiente",
  CANCELED: "Cancelada",
  EXPIRED: "Vencida",
  INCOMPLETE: "Pago incompleto",
} as const;

function formatUsd(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatArsValue(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTestArsValue(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatArs(value: number, rate: number): string {
  return formatArsValue(convertUsdToArs(value, rate));
}

function formatRate(rate: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(rate);
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "Fecha de actualización no informada";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatSubscriptionDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

function buttonLabel(input: {
  planId: BillingPlanId;
  billing: BillingOverview;
}) {
  const current = input.billing.entitlement.plan === input.planId;
  const status = input.billing.entitlement.status;
  if (input.billing.pendingPlan === input.planId) return "Continuar pago";
  if (status === "ACTIVE" && current) return "Plan actual";
  if ((status === "EXPIRED" || status === "CANCELED") && current) {
    return "Reactivar suscripción";
  }
  if (status === "ACTIVE") return "Cambiar de plan";
  if (input.planId === "STANDARD") return "Comenzar con Standard";
  return input.planId === "PROFESSIONAL"
    ? "Elegir Profesional"
    : "Elegir Empresarial";
}

export function PlansPricing({
  exchange,
  billing,
  canManage,
}: {
  exchange: PlansExchangeRate;
  billing: BillingOverview;
  canManage: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [currency, setCurrency] = useState<Currency>("USD");
  const [confirming, setConfirming] = useState<BillingPlanId | null>(null);
  const [loading, setLoading] = useState<BillingPlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [managementLoading, setManagementLoading] = useState<
    "sync" | "cancel" | null
  >(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const checkoutAttempt = useRef<{
    plan: BillingPlanId;
    idempotencyKey: string;
  } | null>(null);
  const submitting = useRef(false);
  const exchangeRate = exchange.rate;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = window.sessionStorage.getItem("vantix-plans-currency");
      if (stored === "ARS" && exchangeRate) setCurrency("ARS");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [exchangeRate]);

  useEffect(() => {
    if (searchParams.get("payment") === "processing") {
      toast.info(
        "El pago está siendo validado. El plan se activará cuando Mercado Pago lo confirme."
      );
    }
  }, [searchParams]);

  const subscriptionDate = useMemo(
    () =>
      formatSubscriptionDate(
        billing.entitlement.status === "TRIALING"
          ? billing.entitlement.trialEndsAt
          : billing.entitlement.currentPeriodEndsAt
      ),
    [billing.entitlement]
  );
  const nextBillingDate = useMemo(
    () => formatSubscriptionDate(billing.entitlement.nextBillingAt),
    [billing.entitlement.nextBillingAt]
  );
  const lastSyncedAt = useMemo(
    () => formatSubscriptionDate(billing.lastSyncedAt),
    [billing.lastSyncedAt]
  );

  function selectCurrency(next: Currency) {
    if (next === "ARS" && !exchangeRate) return;
    setCurrency(next);
    window.sessionStorage.setItem("vantix-plans-currency", next);
  }

  async function startCheckout(planId: BillingPlanId) {
    if (submitting.current) return;
    submitting.current = true;
    const attempt =
      checkoutAttempt.current?.plan === planId
        ? checkoutAttempt.current
        : { plan: planId, idempotencyKey: crypto.randomUUID() };
    checkoutAttempt.current = attempt;
    setLoading(planId);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: planId,
          idempotencyKey: attempt.idempotencyKey,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { checkout?: { checkoutUrl?: string }; message?: string }
        | null;
      if (!response.ok || !body?.checkout?.checkoutUrl) {
        throw new Error(body?.message ?? "No se pudo iniciar el pago.");
      }
      window.location.assign(body.checkout.checkoutUrl);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "No se pudo iniciar el pago."
      );
      setLoading(null);
      submitting.current = false;
      checkoutAttempt.current = null;
    }
  }

  async function runManagementAction(action: "sync" | "cancel") {
    if (managementLoading) return;
    setManagementLoading(action);
    setError(null);
    try {
      const response = await fetch(`/api/billing/${action}`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          body?.message ??
            (action === "sync"
              ? "No se pudo sincronizar la suscripción."
              : "No se pudo cancelar la suscripción.")
        );
      }
      toast.success(
        action === "sync"
          ? "Estado sincronizado con Mercado Pago."
          : "La cancelación quedó registrada. Conservás acceso hasta el fin del período pago."
      );
      setConfirmCancel(false);
      router.refresh();
    } catch (managementError) {
      setError(
        managementError instanceof Error
          ? managementError.message
          : "No se pudo completar la operación."
      );
    } finally {
      setManagementLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 rounded-xl border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">
              Plan actual: {billing.entitlement.planName}
            </p>
            <Badge variant="outline">
              {STATUS_LABELS[billing.entitlement.status]}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {billing.entitlement.status === "TRIALING"
              ? `Prueba gratuita${subscriptionDate ? ` hasta el ${subscriptionDate}` : ""}.`
              : subscriptionDate
                ? `Período vigente hasta el ${subscriptionDate}.`
                : "Estado confirmado por el servidor."}
          </p>
          {billing.entitlement.status === "ACTIVE" && nextBillingDate && (
            <p className="mt-1 text-xs font-medium text-foreground">
              Próximo cobro: {nextBillingDate}
            </p>
          )}
          {lastSyncedAt && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Estado confirmado con Mercado Pago: {lastSyncedAt}
            </p>
          )}
          {canManage && (billing.canSynchronize || billing.canCancel) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {billing.canSynchronize && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={managementLoading !== null}
                  onClick={() => runManagementAction("sync")}
                >
                  {managementLoading === "sync" && (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  )}
                  Sincronizar estado
                </Button>
              )}
              {billing.canCancel && !confirmCancel && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={managementLoading !== null}
                  onClick={() => setConfirmCancel(true)}
                >
                  Cancelar renovación
                </Button>
              )}
              {billing.canCancel && confirmCancel && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/[0.06] p-2">
                  <span className="text-xs text-muted-foreground">
                    ¿Confirmás la cancelación al final del período?
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={managementLoading !== null}
                    onClick={() => runManagementAction("cancel")}
                  >
                    {managementLoading === "cancel" && (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    )}
                    Confirmar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={managementLoading !== null}
                    onClick={() => setConfirmCancel(false)}
                  >
                    Volver
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        <div
          className="inline-flex w-fit rounded-lg border border-border bg-muted p-1"
          role="group"
          aria-label="Moneda de los planes"
        >
          {(["USD", "ARS"] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={option === "ARS" && !exchangeRate}
              aria-pressed={currency === option}
              title={
                option === "ARS" && !exchangeRate
                  ? "La cotización ARS todavía no está disponible"
                  : undefined
              }
              onClick={() => selectCurrency(option)}
              className={cn(
                "min-h-9 min-w-16 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-45",
                currency === option
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div
        className={cn(
          "rounded-xl border p-4",
          exchangeRate
            ? "border-border bg-muted/35"
            : "border-amber-500/25 bg-amber-500/[0.07]"
        )}
      >
        <div className="flex items-start gap-3">
          {!exchangeRate && (
            <CircleAlert
              className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300"
              aria-hidden
            />
          )}
          <div>
            <p className="text-sm font-semibold">Cotización utilizada</p>
            {exchangeRate ? (
              <>
                <p className="mt-1 text-sm">1 USD = {formatRate(exchangeRate)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Actualizado: {formatUpdatedAt(exchange.updatedAt)}
                  {exchange.source === "DolarHoy" ? " · Fuente: DolarHoy" : ""}
                  {exchange.source && exchange.source !== "DolarHoy"
                    ? ` · Fuente: ${exchange.source}`
                    : ""}
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                ARS está temporalmente no disponible. No se puede iniciar un pago hasta contar con una cotización válida.
              </p>
            )}
          </div>
        </div>
      </div>

      {!billing.billingConfigured && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4 text-sm text-muted-foreground" role="status">
          {billing.checkoutUnavailableReason}
        </div>
      )}
      {billing.testCheckout && billing.testAmountArs !== null && (
        <div
          className="rounded-xl border border-sky-500/30 bg-sky-500/[0.08] p-4 text-sm text-foreground"
          role="status"
        >
          <strong>
            Pago de prueba: ARS {formatTestArsValue(billing.testAmountArs)}.
          </strong>{" "}
          El precio comercial del plan no fue modificado.
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      <section className="grid items-stretch gap-4 lg:grid-cols-3" aria-label="Planes disponibles">
        {BILLING_PLAN_LIST.map((plan) => {
          const Icon = PLAN_ICONS[plan.id];
          const price =
            currency === "ARS" && exchangeRate
              ? formatArs(plan.usdMonthly, exchangeRate)
              : formatUsd(plan.usdMonthly);
          const label = buttonLabel({ planId: plan.id, billing });
          const disabled = isPlanCheckoutDisabled({
            targetPlan: plan.id,
            currentPlan: billing.entitlement.plan,
            subscriptionStatus: billing.entitlement.status,
            canManage,
            checkoutLoading: loading !== null,
          });
          const amountArs = exchangeRate
            ? convertUsdToArs(plan.usdMonthly, exchangeRate)
            : 0;

          return (
            <Card
              key={plan.id}
              className={cn(
                "relative h-full",
                plan.recommended &&
                  "border-primary/55 shadow-[0_24px_60px_-42px_var(--primary)]"
              )}
            >
              {plan.recommended && (
                <Badge className="absolute right-4 top-4">Recomendado</Badge>
              )}
              <CardHeader className="min-h-44 border-b pr-28">
                <span className="flex size-10 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
                  <Icon className="size-4.5" aria-hidden />
                </span>
                <CardTitle className="mt-3 text-lg">{plan.name}</CardTitle>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {plan.description}
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-6">
                <div>
                  <p className="text-3xl font-semibold tracking-[-0.045em]">
                    {price}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">por mes</p>
                </div>
                <ul className="space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Check className="size-3" aria-hidden />
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter className="flex-col gap-2">
                {confirming === plan.id && !disabled ? (
                  <div className="w-full space-y-3 rounded-lg border border-primary/25 bg-primary/[0.06] p-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {billing.testCheckout && billing.testAmountArs !== null ? (
                        <>
                          <strong className="text-foreground">
                            Pago de prueba: ARS{" "}
                            {formatTestArsValue(billing.testAmountArs)}.
                          </strong>{" "}
                          El precio comercial del plan no fue modificado. Precio
                          comercial de referencia: {formatArsValue(amountArs)}.
                        </>
                      ) : (
                        <>
                          Mercado Pago cobrará{" "}
                          <strong className="text-foreground">
                            {formatArsValue(amountArs)}
                          </strong>{" "}
                          por mes usando 1 USD = {formatRate(exchangeRate!)}. Las
                          renovaciones conservarán ese importe hasta un cambio
                          explícito y auditable.
                        </>
                      )}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={loading !== null}
                        onClick={() => startCheckout(plan.id)}
                      >
                        {loading === plan.id && <Loader2 className="size-4 animate-spin" aria-hidden />}
                        Confirmar y continuar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={loading !== null}
                        onClick={() => {
                          checkoutAttempt.current = null;
                          setConfirming(null);
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant={plan.recommended ? "default" : "outline"}
                    className="w-full"
                    disabled={disabled}
                    title={
                      !canManage
                        ? "Solo propietarios y administradores pueden gestionar el plan"
                        : undefined
                    }
                    onClick={() => {
                      setError(null);
                      if (!billing.billingConfigured) {
                        setError(
                          billing.checkoutUnavailableReason ??
                            "Mercado Pago todavía no está configurado."
                        );
                        return;
                      }
                      if (!exchangeRate) {
                        setError(
                          "No hay una cotización válida disponible para iniciar el pago en ARS."
                        );
                        return;
                      }
                      checkoutAttempt.current = {
                        plan: plan.id,
                        idempotencyKey: crypto.randomUUID(),
                      };
                      setConfirming(plan.id);
                    }}
                  >
                    {loading === plan.id && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    {label}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </section>

      <div className="rounded-xl border border-border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
        Las tarifas variables de mensajería de Meta y los consumos extraordinarios pueden cobrarse por separado.
      </div>
    </div>
  );
}
