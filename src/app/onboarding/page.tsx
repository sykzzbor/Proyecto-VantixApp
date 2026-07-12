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
    <div className="flex min-h-svh flex-1 flex-col bg-background">
      <header className="flex h-16 items-center border-b border-border/60 px-5 sm:px-8">
        <span className="text-lg font-semibold tracking-[-0.04em]">Vantix<span className="text-primary">App</span></span>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:px-6 sm:py-10">
        <div className="w-full max-w-md">
          <CreateOrganizationForm userName={user.name} />
        </div>
      </main>
    </div>
  );
}
