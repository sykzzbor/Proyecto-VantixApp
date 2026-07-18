import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Check, Sparkles, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Planes" };

const PLANS = [
  {
    name: "Básico",
    price: "USD 90",
    suffix: "/mes",
    description: "La base operativa para centralizar la atención de un negocio.",
    icon: Zap,
    recommended: false,
    features: ["Panel comercial", "Conversaciones centralizadas", "Agente IA", "Base de conocimiento"],
  },
  {
    name: "Profesional",
    price: "USD 179",
    suffix: "/mes",
    description: "Para equipos que necesitan automatización, agenda y mayor control.",
    icon: Sparkles,
    recommended: true,
    features: ["Todo lo incluido en Básico", "Automatizaciones operativas", "Google Calendar y turnos", "Métricas avanzadas"],
  },
  {
    name: "Empresa",
    price: "Personalizado",
    suffix: "",
    description: "Una implementación acompañada para operaciones con necesidades específicas.",
    icon: Building2,
    recommended: false,
    features: ["Alcance a medida", "Acompañamiento de implementación", "Integraciones evaluadas", "Soporte coordinado"],
  },
] as const;

export default function PlansPage() {
  return (
    <div className="space-y-7">
      <PageHeader
        title="Planes y suscripción"
        description="Compará el alcance de cada plan. Los cambios de suscripción se coordinan con el equipo de Vantix."
      />

      <section className="grid items-stretch gap-4 lg:grid-cols-3" aria-label="Planes disponibles">
        {PLANS.map((plan) => {
          const Icon = plan.icon;
          return (
            <Card
              key={plan.name}
              className={cn(
                "relative h-full",
                plan.recommended && "border-primary/55 shadow-[0_24px_60px_-42px_var(--primary)]"
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
                <p className="text-sm leading-relaxed text-muted-foreground">{plan.description}</p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-6">
                <div>
                  <p className="text-3xl font-semibold tracking-[-0.045em]">{plan.price}</p>
                  {plan.suffix && <p className="mt-1 text-xs text-muted-foreground">{plan.suffix}</p>}
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

      <div className="rounded-xl border border-border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
        Las tarifas de Meta por conversaciones y los consumos extraordinarios de proveedores externos se liquidan según el uso y no están incluidos en el abono base.
      </div>
    </div>
  );
}
