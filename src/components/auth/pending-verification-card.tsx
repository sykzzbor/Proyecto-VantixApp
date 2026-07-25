"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { resendVerificationEmail } from "@/server/actions/email-verification";
import { RESEND_COOLDOWN_SECONDS } from "@/server/auth/verification-token";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { AuthCardHeader } from "@/components/auth/auth-card-header";
import { SubmitButton } from "@/components/forms/submit-button";

/**
 * Pantalla "Revisá tu correo".
 *
 * El cooldown se muestra en pantalla, pero es solo una cortesía: quien manda
 * es el contador persistido del servidor, que también cuenta los pedidos que
 * no pasan por acá.
 */
export function PendingVerificationCard({
  email,
  initialCooldown,
  hasSession,
}: {
  email: string | null;
  initialCooldown: number | null;
  hasSession: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(initialCooldown ?? 0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((value) => (value > 0 ? value - 1 : 0));
    }, 1_000);
    return () => clearInterval(timer);
  }, [cooldown]);

  function handleResend() {
    if (!email || cooldown > 0 || pending) return;
    startTransition(async () => {
      const result = await resendVerificationEmail({ email });
      setMessage(result.message);
      setCooldown(result.retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS);
    });
  }

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Card className="border-border/80 bg-card/95">
      <AuthCardHeader
        eyebrow="Falta un paso"
        title="Revisá tu correo"
        description={
          email
            ? `Te enviamos un enlace de verificación a ${email}. Abrilo para activar tu cuenta.`
            : "Te enviamos un enlace de verificación. Abrilo para activar tu cuenta."
        }
      />
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/40 px-3.5 py-3">
          <MailCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-medium">El enlace vence en 30 minutos.</p>
            <p className="text-muted-foreground">
              Se puede usar una sola vez. Si no lo ves, mirá la carpeta de spam.
            </p>
          </div>
        </div>

        {message && (
          <p
            role="status"
            aria-live="polite"
            className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm text-muted-foreground"
          >
            {message}
          </p>
        )}

        {email && (
          <div className="space-y-2">
            <SubmitButton
              type="button"
              variant="outline"
              className="w-full"
              loading={pending}
              disabled={cooldown > 0}
              onClick={handleResend}
            >
              {cooldown > 0
                ? `Reenviar en ${cooldown}s`
                : "Reenviar el correo de verificación"}
            </SubmitButton>
            {cooldown > 0 && (
              <p className="text-center text-xs text-muted-foreground">
                Esperá unos segundos antes de pedir otro enlace.
              </p>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-col gap-3 pt-2">
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          ¿Escribiste mal tu correo? Cerrá sesión y registrate de nuevo con la
          dirección correcta.
        </p>
        {hasSession ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={handleSignOut}
          >
            Cerrar sesión
          </Button>
        ) : (
          <Button asChild variant="ghost" className="w-full text-muted-foreground">
            <Link href="/login">Volver a iniciar sesión</Link>
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
