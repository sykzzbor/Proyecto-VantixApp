import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bot, CalendarClock, Check, MessageSquareText, Plug, Store } from "lucide-react";
import { VantixLogo } from "@/components/brand/vantix-logo";
import { CreateOrganizationForm } from "@/components/onboarding/create-organization-form";
import { hasMembership, requireUser } from "@/server/context";

export const metadata: Metadata = {
  title: "Crear tu negocio",
};

export default async function OnboardingPage() {
  const user = await requireUser();
  if (await hasMembership(user.id)) redirect("/dashboard");

  return (
    <div className="flex min-h-svh flex-1 flex-col bg-background">
      <header className="flex h-16 items-center border-b border-border/70 bg-card px-5 sm:px-8">
        <div className="rounded-md bg-sidebar px-3 py-1.5">
          <VantixLogo priority className="w-24" />
        </div>
        <span className="ml-auto text-xs font-medium text-muted-foreground">Configuración inicial</span>
      </header>
      <main className="flex flex-1 items-center px-4 py-8 sm:px-6 lg:px-10">
        <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card shadow-[0_28px_80px_-56px_rgba(15,23,42,.45)] lg:grid-cols-[minmax(0,.9fr)_minmax(25rem,1.1fr)]">
          <aside className="border-b border-border bg-muted/45 p-6 sm:p-8 lg:border-r lg:border-b-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Paso 1 de 5</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">Prepará tu espacio de trabajo</h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Empezamos por la organización. Después vas a poder completar cada integración desde el dashboard, sin configurar todo de una sola vez.
            </p>
            <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-border" aria-label="20% del onboarding iniciado">
              <div className="h-full w-1/5 rounded-full bg-primary" />
            </div>
            <ol className="mt-7 space-y-3">
              {[
                { icon: Store, label: "Crear la organización", current: true },
                { icon: Plug, label: "Conectar WhatsApp" },
                { icon: Bot, label: "Configurar el agente" },
                { icon: CalendarClock, label: "Preparar Google Calendar" },
                { icon: MessageSquareText, label: "Probar una conversación" },
              ].map((step, index) => {
                const Icon = step.icon;
                return (
                  <li key={step.label} className="flex items-center gap-3">
                    <span className={step.current ? "flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground" : "flex size-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"}>
                      {step.current ? <Check className="size-4" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
                    </span>
                    <div>
                      <p className={step.current ? "text-sm font-semibold" : "text-sm text-muted-foreground"}>{step.label}</p>
                      <p className="text-[10px] text-muted-foreground">{step.current ? "Paso actual" : `Paso ${index + 1}`}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </aside>
          <div className="flex items-center p-5 sm:p-8 lg:p-10">
            <div className="w-full">
              <CreateOrganizationForm userName={user.name} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
