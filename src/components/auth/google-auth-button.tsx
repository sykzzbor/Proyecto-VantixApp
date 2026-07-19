"use client";

import { useState } from "react";
import { CircleUserRound, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import {
  buildGoogleAuthRequest,
  type GoogleAuthMode,
} from "@/lib/google-auth-request";
import { translateAuthError } from "@/lib/auth-errors";

type GoogleAuthButtonProps = {
  mode: GoogleAuthMode;
  configured: boolean;
  callbackURL?: string;
  invitationToken?: string;
  onError: (message: string) => void;
};

export function GoogleAuthButton({
  mode,
  configured,
  callbackURL,
  invitationToken,
  onError,
}: GoogleAuthButtonProps) {
  const [loading, setLoading] = useState(false);

  async function continueWithGoogle() {
    if (!configured || loading) return;
    setLoading(true);
    onError("");

    try {
      const { error } = await authClient.signIn.social(
        buildGoogleAuthRequest({ mode, callbackURL, invitationToken })
      );
      if (error) {
        onError(translateAuthError(error));
        setLoading(false);
      }
    } catch {
      onError("No se pudo iniciar el acceso con Google. Intentá de nuevo.");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full bg-background"
        disabled={!configured || loading}
        onClick={continueWithGoogle}
      >
        {loading ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : (
          <CircleUserRound className="size-4" aria-hidden />
        )}
        {loading ? "Abriendo Google…" : "Continuar con Google"}
      </Button>
      {!configured && (
        <p className="text-center text-xs text-muted-foreground">
          El acceso con Google requiere configuración en este entorno.
        </p>
      )}
    </div>
  );
}
