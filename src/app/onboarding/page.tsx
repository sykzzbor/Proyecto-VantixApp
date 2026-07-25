import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bot, CalendarClock, Check, MessageSquareText, Plug, Store } from "lucide-react";
import { VantixLogo } from "@/components/brand/vantix-logo";
import { CreateOrganizationForm } from "@/components/onboarding/create-organization-form";
import { findActiveMembership, requireUser } from "@/server/context";
import { getOnboardingState } from "@/server/organizations/onboarding-state";
import { stepPath } from "@/server/organizations/onboarding-paths";

export const metadata: Metadata = {
  title: "Crear tu negocio",
  robots: { index: false, follow: false },
};

/**
 * Paso 1 del asistente: crear la organización.
 *
 * `requireUser` ya exige sesión CON correo verificado, así que una cuenta sin
 * confirmar no llega hasta acá y no puede disparar la creación del negocio
 * (ni, por lo tanto, el arranque del trial).
 */
export default async function OnboardingPage(props: PageProps<"/onboarding">) {
  const user = await requireUser();

  // Si ya tiene negocio, este paso está hecho: retoma donde quedó en vez de
  // mandar siempre al dashboard.
  const membership = await findActiveMembership(user.id);
  if (membership) {
    const state = await getOnboardingState(membership.organization.id);
    redirect(state ? stepPath(state.nextStep) : "/dashboard");
  }

  const searchParams = await props.searchParams;
  // Nombre propuesto en el registro; es solo un valor inicial editable.
  const suggestedName =
    typeof searchParams.negocio === "string"
      ? searchParams.negocio.slice(0, 120)
      : "";

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
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Paso 1 de 7</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">Prepará tu espacio de trabajo</h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Empezamos por el negocio. Después vas a completar la información, los horarios y el catálogo, paso por paso y sin apuro.
            </p>
            <div
              className="mt-6 h-1.5 overflow-hidden rounded-full bg-border"
              role="progressbar"
              aria-valuenow={14}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Onboarding iniciado"
            >
              <div className="h-full w-[14%] rounded-full bg-primary" />
            </div>
            <ol className="mt-7 space-y-3">
              {[
                { icon: Store, label: "Crear el negocio", current: true },
                { icon: Bot, label: "Información y horarios" },
                { icon: MessageSquareText, label: "Productos y preguntas" },
                { icon: Plug, label: "Integraciones (opcional)" },
                { icon: CalendarClock, label: "Probar el agente" },
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
              <CreateOrganizationForm
                userName={user.name}
                suggestedName={suggestedName}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
