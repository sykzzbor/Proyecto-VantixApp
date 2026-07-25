import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { OnboardingWizardShell } from "@/components/onboarding/wizard-shell";
import { StepNavigation } from "@/components/onboarding/step-navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  redirectIfStepLocked,
  requireOnboardingContext,
} from "@/server/organizations/onboarding-context";
import { rememberLastStep } from "@/server/organizations/onboarding-state";
import { stepPath } from "@/server/organizations/onboarding-paths";

export const metadata: Metadata = {
  title: "Integraciones",
  robots: { index: false, follow: false },
};

export default async function OnboardingIntegrationsPage() {
  const { org, state } = await requireOnboardingContext();
  redirectIfStepLocked(state, "integraciones");
  await rememberLastStep(org.id, "integraciones");

  const [whatsapp, calendar, sheets] = await Promise.all([
    prisma.whatsappIntegration.count({
      where: { organizationId: org.id, status: "CONNECTED" },
    }),
    prisma.googleCalendarConnection.count({
      where: { organizationId: org.id, status: "CONNECTED" },
    }),
    prisma.googleSheetsConnection.count({
      where: { organizationId: org.id, status: "CONNECTED" },
    }),
  ]);

  const integrations = [
    {
      label: "WhatsApp",
      description: "Atendé desde el número de tu negocio.",
      connected: whatsapp > 0,
    },
    {
      label: "Google Calendar",
      description: "Sincronizá los turnos que agende el agente.",
      connected: calendar > 0,
    },
    {
      label: "Google Sheets",
      description: "Exportá conversaciones y clientes a una planilla.",
      connected: sheets > 0,
    },
  ];

  return (
    <OnboardingWizardShell state={state} current="integraciones">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {integrations.map((integration) => (
            <Card key={integration.label}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{integration.label}</h3>
                  <Badge variant={integration.connected ? "default" : "outline"}>
                    {integration.connected ? "Conectada" : "Sin conectar"}
                  </Badge>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {integration.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Ninguna integración es obligatoria para empezar. Podés conectarlas
            ahora o cuando quieras desde el dashboard.
          </p>
          <Link
            href="/dashboard/integraciones"
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Ir al centro de integraciones
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>

      <StepNavigation
        step="integraciones"
        previousPath={stepPath("catalogo")}
        nextPath={stepPath("prueba")}
        optional
        submitLabel="Continuar"
      />
    </OnboardingWizardShell>
  );
}
