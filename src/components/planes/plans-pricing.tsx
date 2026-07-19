"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Check, CircleAlert, Sparkles, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Currency = "USD" | "ARS";

const PLANS = [
  {
    name: "Básico",
    usd: 90,
    description: "La base operativa para centralizar la atención de un negocio.",
    icon: Zap,
    recommended: false,
    features: ["Panel comercial", "Conversaciones centralizadas", "Agente IA", "Base de conocimiento"],
  },
  {
    name: "Profesional",
    usd: 179,
    description: "Para equipos que necesitan automatización, agenda y mayor control.",
    icon: Sparkles,
    recommended: true,
    features: ["Todo lo incluido en Básico", "Automatizaciones operativas", "Google Calendar y turnos", "Métricas avanzadas"],
  },
  {
    name: "Empresa",
    usd: null,
    description: "Una implementación acompañada para operaciones con necesidades específicas.",
    icon: Building2,
    recommended: false,
    features: ["Alcance a medida", "Acompañamiento de implementación", "Integraciones evaluadas", "Soporte coordinado"],
  },
] as const;

function formatUsd(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatArs(value: number, rate: number): string {
  const rounded = Math.ceil((value * rate) / 1000) * 1000;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(rounded);
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

export function PlansPricing({
  exchangeRate,
  exchangeUpdatedAt,
}: {
  exchangeRate: number | null;
  exchangeUpdatedAt: string | null;
}) {
  const [currency, setCurrency] = useState<Currency>("USD");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = window.sessionStorage.getItem("vantix-plans-currency");
      if (stored === "ARS" && exchangeRate) setCurrency("ARS");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [exchangeRate]);

  function selectCurrency(next: Currency) {
    if (next === "ARS" && !exchangeRate) return;
    setCurrency(next);
    window.sessionStorage.setItem("vantix-plans-currency", next);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Moneda de referencia</p>
          <p className="mt-1 text-xs text-muted-foreground">
            La selección se conserva durante esta sesión.
          </p>
        </div>
        <div className="inline-flex w-fit rounded-lg border border-border bg-muted p-1" role="group" aria-label="Moneda de los planes">
          {(["ARS", "USD"] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={option === "ARS" && !exchangeRate}
              aria-pressed={currency === option}
              title={option === "ARS" && !exchangeRate ? "La cotización ARS todavía no está configurada" : undefined}
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

      <section className="grid items-stretch gap-4 lg:grid-cols-3" aria-label="Planes disponibles">
        {PLANS.map((plan) => {
          const Icon = plan.icon;
          const price =
            plan.usd === null
              ? "Precio personalizado"
              : currency === "ARS" && exchangeRate
                ? formatArs(plan.usd, exchangeRate)
                : formatUsd(plan.usd);
          return (
            <Card
              key={plan.name}
              className={cn(
                "relative h-full",
                plan.recommended && "border-primary/55 shadow-[0_24px_60px_-42px_var(--primary)]"
              )}
            >
              {plan.recommended && <Badge className="absolute right-4 top-4">Recomendado</Badge>}
              <CardHeader className="min-h-44 border-b pr-28">
                <span className="flex size-10 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
                  <Icon className="size-4.5" aria-hidden />
                </span>
                <CardTitle className="mt-3 text-lg">{plan.name}</CardTitle>
                <p className="text-sm leading-relaxed text-muted-foreground">{plan.description}</p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-6">
                <div>
                  <p className="text-3xl font-semibold tracking-[-0.045em]">{price}</p>
                  {plan.usd !== null && <p className="mt-1 text-xs text-muted-foreground">por mes</p>}
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
              <CardFooter>
                <Button asChild variant={plan.recommended ? "default" : "outline"} className="w-full">
                  <Link href="/dashboard/ayuda">Consultar este plan</Link>
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </section>

      <div className={cn(
        "rounded-xl border p-4",
        exchangeRate ? "border-border bg-muted/35" : "border-amber-500/25 bg-amber-500/[0.07]"
      )}>
        <div className="flex items-start gap-3">
          {!exchangeRate && <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />}
          <div>
            <p className="text-sm font-semibold">Cotización del dólar utilizada</p>
            {exchangeRate ? (
              <>
                <p className="mt-1 text-sm">1 USD = {formatRate(exchangeRate)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Actualizado: {formatUpdatedAt(exchangeUpdatedAt)}</p>
              </>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                La cotización ARS no está configurada. Para evitar mostrar un precio inventado, los planes se mantienen en USD.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
        Las tarifas variables de mensajería de Meta y los consumos extraordinarios pueden cobrarse por separado.
      </div>
    </div>
  );
}
