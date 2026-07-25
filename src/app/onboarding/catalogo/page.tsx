import type { Metadata } from "next";
import { CircleAlert } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { OnboardingWizardShell } from "@/components/onboarding/wizard-shell";
import { ResourceChecklist } from "@/components/onboarding/resource-checklist";
import { StepNavigation } from "@/components/onboarding/step-navigation";
import {
  redirectIfStepLocked,
  requireOnboardingContext,
} from "@/server/organizations/onboarding-context";
import { rememberLastStep } from "@/server/organizations/onboarding-state";
import { stepPath } from "@/server/organizations/onboarding-paths";

export const metadata: Metadata = {
  title: "Productos, servicios y preguntas",
  robots: { index: false, follow: false },
};

export default async function OnboardingCatalogPage() {
  const { org, state } = await requireOnboardingContext();
  redirectIfStepLocked(state, "catalogo");
  await rememberLastStep(org.id, "catalogo");

  const [products, services, faqs, documents] = await Promise.all([
    prisma.product.count({ where: { organizationId: org.id } }),
    prisma.service.count({ where: { organizationId: org.id } }),
    prisma.faq.count({ where: { organizationId: org.id } }),
    prisma.knowledgeDocument.count({ where: { organizationId: org.id } }),
  ]);

  const total = products + services + faqs + documents;

  return (
    <OnboardingWizardShell state={state} current="catalogo">
      <div className="space-y-5">
        <ResourceChecklist
          items={[
            {
              label: "Productos",
              description: "Lo que vendés, con precio y stock.",
              count: products,
              href: "/dashboard/productos",
            },
            {
              label: "Servicios",
              description: "Lo que ofrecés por turno o presupuesto.",
              count: services,
              href: "/dashboard/servicios",
            },
            {
              label: "Preguntas frecuentes",
              description: "Las dudas que más te repiten.",
              count: faqs,
              href: "/dashboard/preguntas",
            },
            {
              label: "Documentos",
              description: "Catálogos o manuales que el agente puede consultar.",
              count: documents,
              href: "/dashboard/conocimiento",
            },
          ]}
        />

        {total === 0 ? (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-muted-foreground">
              Cargá al menos una cosa para continuar. Sin nada de esto el agente
              no tiene con qué responder. Podés empezar con una sola pregunta
              frecuente y ampliar después.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ya tenés {total} {total === 1 ? "elemento cargado" : "elementos cargados"}.
            Podés seguir sumando en cualquier momento desde el dashboard.
          </p>
        )}
      </div>

      <StepNavigation
        step="catalogo"
        previousPath={stepPath("horarios")}
        nextPath={stepPath("integraciones")}
        disabled={total === 0}
        submitLabel="Continuar"
      />
    </OnboardingWizardShell>
  );
}
