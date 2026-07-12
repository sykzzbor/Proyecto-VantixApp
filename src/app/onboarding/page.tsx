import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CreateOrganizationForm } from "@/components/onboarding/create-organization-form";
import { hasMembership, requireUser } from "@/server/context";

export const metadata: Metadata = {
  title: "Crear tu negocio",
};

export default async function OnboardingPage() {
  const user = await requireUser();
  if (await hasMembership(user.id)) redirect("/dashboard");

  return (
    <div className="flex min-h-svh flex-1 flex-col bg-muted/40">
      <header className="px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">Vantix</span>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-4">
        <div className="w-full max-w-md">
          <CreateOrganizationForm userName={user.name} />
        </div>
      </main>
    </div>
  );
}
