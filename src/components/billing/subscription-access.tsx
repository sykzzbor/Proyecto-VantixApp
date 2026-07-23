"use client";

import Link from "next/link";
import { Check, CreditCard, LockKeyhole } from "lucide-react";
import { SUPPORT_WHATSAPP_URL } from "@/components/public/public-footer";
import type { OrganizationEntitlement } from "@/server/billing/entitlement";
import { isSubscriptionSafeDashboardPath } from "@/lib/billing/entitlement";
import { BILLING_PLAN_LIST } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

function formatDate(value: string | null) {
  if (!value) return "Sin fecha informada";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

/** Fecha de vencimiento compacta para el aviso global. */
function formatDeadline(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function TrialBanner({
  entitlement,
}: {
  entitlement: OrganizationEntitlement;
}) {
  if (entitlement.internalPlanTest) {
    return (
      <aside
        className="shrink-0 border-b border-violet-400/25 bg-violet-700 px-3 py-2 text-white"
        aria-label={`Modo interno de prueba del plan ${entitlement.planName}.`}
      >
        <div className="mx-auto flex min-h-5 max-w-[1440px] items-center justify-center gap-1.5 text-center text-[11px] leading-4 sm:text-xs">
          <p>
            <span className="font-semibold">Modo interno de prueba:</span>{" "}
            {entitlement.planName} habilitado sin Mercado Pago
            {entitlement.internalPlanTestEndsAt
              ? ` hasta el ${formatDeadline(entitlement.internalPlanTestEndsAt)}.`
              : "."}
          </p>
          <Link
            href="/dashboard/planes"
            className="shrink-0 font-medium underline underline-offset-2 transition-opacity hover:opacity-80 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            Administrar
          </Link>
        </div>
      </aside>
    );
  }
  if (
    !entitlement.accessAllowed ||
    entitlement.status !== "TRIALING" ||
    !entitlement.trialEndsAt
  ) {
    return null;
  }
  const expiresToday = entitlement.remainingMs < 24 * 60 * 60 * 1_000;
  const remainingLabel = expiresToday
    ? `Te quedan ${entitlement.remainingHours} horas gratis.`
    : `Te quedan ${entitlement.remainingDays} días gratis.`;

  return (
    <aside
      className="shrink-0 border-b border-primary-foreground/10 bg-primary px-3 py-2 text-primary-foreground"
      aria-label={`Período de prueba del plan ${entitlement.planName}. ${remainingLabel} Finaliza el ${formatDate(entitlement.trialEndsAt)}.`}
    >
      <div className="mx-auto flex min-h-5 max-w-[1440px] items-center justify-center gap-1.5 text-center text-[11px] leading-4 sm:text-xs">
        <p>
          <span className="font-semibold">Período de prueba:</span>{" "}
          {remainingLabel}{" "}
          <span className="opacity-90">
            Vence el {formatDeadline(entitlement.trialEndsAt)}.
          </span>
        </p>
        <Link
          href="/dashboard/planes"
          className="shrink-0 font-medium underline underline-offset-2 transition-opacity hover:opacity-80 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/70"
        >
          Ver planes
        </Link>
      </div>
    </aside>
  );
}

export function SubscriptionAccessGate({
  pathname,
  entitlement,
  children,
}: {
  pathname: string;
  entitlement: OrganizationEntitlement;
  children: React.ReactNode;
}) {
  if (
    entitlement.accessAllowed ||
    isSubscriptionSafeDashboardPath(pathname)
  ) {
    return children;
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl items-center py-8">
      <section className="w-full space-y-6" aria-labelledby="subscription-blocked-title">
        <div className="mx-auto max-w-2xl text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <LockKeyhole className="size-5" aria-hidden />
          </span>
          <Badge variant="outline" className="mt-4">
            Cuenta pausada
          </Badge>
          <h1 id="subscription-blocked-title" className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
            Tu prueba o período contratado terminó
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Toda tu información sigue guardada. Elegí un plan y el acceso operativo se reactivará cuando Mercado Pago confirme el pago.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {BILLING_PLAN_LIST.map((plan) => (
            <Card key={plan.id} className={plan.recommended ? "border-primary/50" : undefined}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold">{plan.name}</h2>
                  {plan.recommended && <Badge>Recomendado</Badge>}
                </div>
                <p className="text-2xl font-semibold">USD {plan.usdMonthly}</p>
                <p className="text-xs text-muted-foreground">por mes</p>
                <ul className="space-y-2 border-t border-border pt-3">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
                    >
                      <Check
                        className="mt-0.5 size-3.5 shrink-0 text-primary"
                        aria-hidden
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/dashboard/planes">
              <CreditCard className="size-4" aria-hidden />
              Ver planes y reactivar
            </Link>
          </Button>
          <Button asChild variant="outline">
            <a href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noreferrer">
              Contactar soporte por WhatsApp
            </a>
          </Button>
        </div>
      </section>
    </div>
  );
}
