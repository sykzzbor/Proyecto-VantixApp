import Link from "next/link";
import { Check, CircleDashed, Lock, SkipForward } from "lucide-react";
import { VantixLogo } from "@/components/brand/vantix-logo";
import { ThemeSwitcher } from "@/components/theme/theme-switcher";
import { Button } from "@/components/ui/button";
import type {
  OnboardingState,
  OnboardingStep,
} from "@/server/organizations/onboarding-progress";
import { cn } from "@/lib/utils";

/**
 * Marco común de los pasos del asistente: cabecera, barra de progreso y la
 * lista de pasos con su estado real (hecho, omitido, pendiente o bloqueado).
 *
 * Es un componente de servidor: el estado ya viene calculado desde la base y
 * el navegador no puede alterarlo.
 */
export function OnboardingWizardShell({
  state,
  current,
  children,
}: {
  state: OnboardingState;
  current: OnboardingStep;
  children: React.ReactNode;
}) {
  const currentIndex = state.steps.findIndex((step) => step.step === current);
  const definition = state.steps[currentIndex];

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border/70 bg-card px-4 sm:px-8">
        <Link href="/dashboard" aria-label="Ir al inicio de Vantix">
          <VantixLogo priority className="w-24 invert dark:invert-0" />
        </Link>
        <span className="ml-auto hidden text-xs font-medium text-muted-foreground sm:inline">
          Configuración inicial
        </span>
        <ThemeSwitcher />
      </header>

      <main className="flex flex-1 justify-center px-4 py-6 sm:px-6 sm:py-10">
        <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)] lg:gap-10">
          <aside className="lg:sticky lg:top-10 lg:self-start">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Paso {currentIndex + 1} de {state.totalCount}
            </p>
            <h1 className="mt-2 text-xl font-semibold tracking-[-0.03em] sm:text-2xl">
              {definition?.title}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {definition?.description}
            </p>

            <div
              className="mt-5 h-1.5 overflow-hidden rounded-full bg-border"
              role="progressbar"
              aria-valuenow={state.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Onboarding completado al ${state.percent}%`}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${state.percent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {state.completedCount} de {state.totalCount} pasos resueltos
            </p>

            <ol className="mt-6 space-y-1.5">
              {state.steps.map((step, index) => {
                const isCurrent = step.step === current;
                const label =
                  step.status === "done"
                    ? "Completado"
                    : step.status === "skipped"
                      ? "Omitido"
                      : step.locked
                        ? "Bloqueado"
                        : isCurrent
                          ? "Paso actual"
                          : "Pendiente";

                const content = (
                  <>
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px]",
                        step.status === "done"
                          ? "border-primary bg-primary text-primary-foreground"
                          : step.status === "skipped"
                            ? "border-border bg-muted text-muted-foreground"
                            : isCurrent
                              ? "border-primary text-primary"
                              : "border-border text-muted-foreground"
                      )}
                    >
                      {step.status === "done" ? (
                        <Check className="size-3.5" aria-hidden />
                      ) : step.status === "skipped" ? (
                        <SkipForward className="size-3" aria-hidden />
                      ) : step.locked ? (
                        <Lock className="size-3" aria-hidden />
                      ) : isCurrent ? (
                        <CircleDashed className="size-3.5" aria-hidden />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block truncate text-sm",
                          isCurrent ? "font-semibold" : "text-muted-foreground"
                        )}
                      >
                        {step.title}
                      </span>
                      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                        {label}
                      </span>
                    </span>
                  </>
                );

                return (
                  <li key={step.step}>
                    {step.locked ? (
                      <div
                        className="flex items-center gap-3 rounded-lg px-2 py-1.5 opacity-60"
                        aria-current={isCurrent ? "step" : undefined}
                      >
                        {content}
                      </div>
                    ) : (
                      <Link
                        href={step.path}
                        aria-current={isCurrent ? "step" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isCurrent && "bg-muted/50"
                        )}
                      >
                        {content}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>

            <Button
              asChild
              variant="ghost"
              size="sm"
              className="mt-6 w-full text-muted-foreground"
            >
              <Link href="/dashboard">Continuar más tarde</Link>
            </Button>
          </aside>

          <div className="min-w-0">{children}</div>
        </div>
      </main>
    </div>
  );
}
