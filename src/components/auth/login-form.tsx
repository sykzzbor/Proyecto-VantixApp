"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { authClient } from "@/lib/auth-client";
import { translateAuthError } from "@/lib/auth-errors";
import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/forms/field-error";
import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { AuthCardHeader } from "@/components/auth/auth-card-header";
import { GoogleAuthButton } from "@/components/auth/google-auth-button";
import { PasswordInput } from "@/components/auth/password-input";

export function LoginForm({
  callbackURL,
  googleConfigured,
  initialError,
}: {
  callbackURL: string;
  googleConfigured: boolean;
  initialError?: string | null;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(initialError ?? null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    const { error } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
    });
    if (error) {
      setFormError(translateAuthError(error));
      return;
    }
    router.push(callbackURL);
    router.refresh();
  }

  return (
    <Card className="border-border/80 bg-card/95 shadow-[0_28px_70px_-42px_rgba(0,0,0,0.95)]">
      <AuthCardHeader
        eyebrow="Espacio de trabajo"
        title="Iniciar sesión"
        description="Ingresá a tu cuenta para gestionar tu operación."
      />
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          <FormAlert message={formError} />
          <GoogleAuthButton
            mode="login"
            configured={googleConfigured}
            callbackURL={callbackURL}
            onError={(message) => setFormError(message || null)}
          />
          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              o continuá con
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="nombre@empresa.com"
              aria-invalid={Boolean(errors.email)}
              {...register("email")}
            />
            <FieldError message={errors.email?.message} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Contraseña</Label>
              <Link
                href="/recuperar-password"
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                ¿La olvidaste?
              </Link>
            </div>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              placeholder="Tu contraseña"
              aria-invalid={Boolean(errors.password)}
              {...register("password")}
            />
            <FieldError message={errors.password?.message} />
          </div>
        </CardContent>
        <CardFooter className="flex-col gap-4 pt-6">
          <SubmitButton loading={isSubmitting} className="w-full">
            Iniciar sesión
          </SubmitButton>
          <p className="text-sm text-muted-foreground">
            ¿Todavía no tenés cuenta?{" "}
            <Link
              href="/registro"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Registrate
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
