"use client";

import Link from "next/link";
import { Clock3, CreditCard, LockKeyhole } from "lucide-react";
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

export function TrialBanner({
  entitlement,
}: {
  entitlement: OrganizationEntitlement;
}) {
  if (
    !entitlement.accessAllowed ||
    entitlement.status !== "TRIALING" ||
    !entitlement.trialEndsAt
  ) {
    return null;
  }
  const expiresToday = entitlement.remainingMs < 24 * 60 * 60 * 1_000;
  const remainingLabel = expiresToday
    ? `Tu prueba gratuita vence hoy. Te quedan ${entitlement.remainingHours} horas.`
    : `Te quedan ${entitlement.remainingDays} días.`;

  return (
    <aside
      className="shrink-0 border-b border-primary/20 bg-primary/[0.07] px-4 py-2.5 text-foreground md:px-6"
      aria-label="Estado de la prueba gratuita"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-2.5 sm:items-center">
          <Clock3 className="mt-0.5 size-4 shrink-0 text-primary sm:mt-0" aria-hidden />
          <p className="min-w-0 text-xs leading-relaxed sm:text-sm">
            <span className="font-semibold">Prueba gratuita · {entitlement.planName}.</span>{" "}
            {remainingLabel}{" "}
            <span className="text-muted-foreground">
              Finaliza el {formatDate(entitlement.trialEndsAt)}.
            </span>
          </p>
        </div>
        <Button asChild size="sm" className="h-8 shrink-0 sm:ml-auto">
          <Link href="/dashboard/planes">Elegir un plan</Link>
        </Button>
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
            <Link href="/dashboard/ayuda">Contactar soporte</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
