"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PartyPopper } from "lucide-react";
import { completeOnboarding } from "@/server/actions/onboarding";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";

export function FinishOnboarding({
  previousPath,
  alreadyComplete,
}: {
  previousPath: string;
  alreadyComplete: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleFinish() {
    setSaving(true);
    setError(null);
    const result = await completeOnboarding();
    if (!result.ok) {
      setError(result.error);
      setSaving(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  if (alreadyComplete) {
    return (
      <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(previousPath)}
        >
          Volver
        </Button>
        <Button
          className="sm:ml-auto sm:min-w-40"
          onClick={() => router.push("/dashboard")}
        >
          Ir al dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FormAlert message={error} />
      <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(previousPath)}
          disabled={saving}
        >
          Anterior
        </Button>
        <SubmitButton
          type="button"
          loading={saving}
          onClick={handleFinish}
          className="sm:ml-auto sm:min-w-48"
        >
          <PartyPopper className="size-4" aria-hidden />
          {saving ? "Finalizando…" : "Finalizar y entrar"}
        </SubmitButton>
      </div>
    </div>
  );
}
