"use client";

import { useActionState } from "react";
import Link from "next/link";
import { CircleCheckBig } from "lucide-react";
import { verifyEmailAction } from "@/server/actions/verify-email";
import { INITIAL_VERIFY_STATE } from "@/lib/validations/verify-email-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { AuthCardHeader } from "@/components/auth/auth-card-header";
import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";

export function VerifyEmailCard({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    verifyEmailAction,
    INITIAL_VERIFY_STATE
  );

  const verified = state.attempt > 0 && !state.error;

  if (verified) {
    return (
      <Card className="border-border/80 bg-card/95">
        <AuthCardHeader
          eyebrow="Cuenta activada"
          title="Tu correo quedó verificado"
          description="Ya podés iniciar sesión y preparar tu espacio de trabajo."
        />
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/40 px-3.5 py-3">
            <CircleCheckBig
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden
            />
            <p className="text-sm text-muted-foreground">
              Por seguridad no te iniciamos la sesión automáticamente: entrá con
              tu correo y contraseña.
            </p>
          </div>
        </CardContent>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/login?verificado=1">Iniciar sesión</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="border-border/80 bg-card/95">
      <AuthCardHeader
        eyebrow="Verificación de correo"
        title="Confirmá tu dirección"
        description="Tocá el botón para activar tu cuenta de Vantix."
      />
      <form action={formAction}>
        <input type="hidden" name="token" value={token} />
        <CardContent className="space-y-4">
          <FormAlert message={state.error} />
          {state.error && (
            <Button asChild variant="outline" className="w-full">
              <Link href="/verificar-email/pendiente">Pedir un enlace nuevo</Link>
            </Button>
          )}
        </CardContent>
        <CardFooter className="flex-col gap-3 pt-2">
          {!state.error && (
            <SubmitButton loading={pending} className="w-full">
              {pending ? "Verificando…" : "Confirmar mi correo"}
            </SubmitButton>
          )}
          <Button asChild variant="ghost" className="w-full text-muted-foreground">
            <Link href="/login">Volver a iniciar sesión</Link>
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
