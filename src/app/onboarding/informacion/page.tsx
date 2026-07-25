import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { BusinessInfoForm } from "@/components/onboarding/business-info-form";
import { OnboardingWizardShell } from "@/components/onboarding/wizard-shell";
import {
  redirectIfStepLocked,
  requireOnboardingContext,
} from "@/server/organizations/onboarding-context";
import { rememberLastStep } from "@/server/organizations/onboarding-state";
import { stepPath } from "@/server/organizations/onboarding-paths";

export const metadata: Metadata = {
  title: "Información del negocio",
  robots: { index: false, follow: false },
};

export default async function OnboardingInfoPage() {
  const { org, state } = await requireOnboardingContext();
  redirectIfStepLocked(state, "informacion");
  await rememberLastStep(org.id, "informacion");

  const profile = await prisma.businessProfile.findUnique({
    where: { organizationId: org.id },
    select: {
      description: true,
      industry: true,
      phone: true,
      email: true,
      address: true,
      city: true,
      country: true,
    },
  });

  return (
    <OnboardingWizardShell state={state} current="informacion">
      <BusinessInfoForm
        previousPath={stepPath("negocio")}
        nextPath={stepPath("horarios")}
        defaults={{
          description: profile?.description ?? "",
          industry: profile?.industry ?? "",
          phone: profile?.phone ?? "",
          email: profile?.email ?? "",
          address: profile?.address ?? "",
          city: profile?.city ?? "",
          country: profile?.country ?? "",
        }}
      />
    </OnboardingWizardShell>
  );
}
