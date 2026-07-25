import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { ScheduleForm } from "@/components/onboarding/schedule-form";
import { OnboardingWizardShell } from "@/components/onboarding/wizard-shell";
import {
  redirectIfStepLocked,
  requireOnboardingContext,
} from "@/server/organizations/onboarding-context";
import { rememberLastStep } from "@/server/organizations/onboarding-state";
import { stepPath } from "@/server/organizations/onboarding-paths";

export const metadata: Metadata = {
  title: "Horarios y zona horaria",
  robots: { index: false, follow: false },
};

export default async function OnboardingSchedulePage() {
  const { org, state } = await requireOnboardingContext();
  redirectIfStepLocked(state, "horarios");
  await rememberLastStep(org.id, "horarios");

  const profile = await prisma.businessProfile.findUnique({
    where: { organizationId: org.id },
    select: { openingHours: true, timeZone: true },
  });

  return (
    <OnboardingWizardShell state={state} current="horarios">
      <ScheduleForm
        previousPath={stepPath("informacion")}
        nextPath={stepPath("catalogo")}
        defaults={{
          openingHours: profile?.openingHours ?? "",
          // Argentina es el mercado principal: arranca ahí en vez de UTC.
          timeZone: profile?.timeZone ?? "America/Argentina/Buenos_Aires",
        }}
      />
    </OnboardingWizardShell>
  );
}
