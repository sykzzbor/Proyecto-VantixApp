"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { authClient } from "@/lib/auth-client";
import { translateAuthError } from "@/lib/auth-errors";
import { registerSchema, type RegisterInput } from "@/lib/validations/auth";
import { createOrganization } from "@/server/actions/organization";
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

export function RegisterForm({
  invitationToken,
  googleConfigured,
  initialError,
}: {
  invitationToken?: string;
  googleConfigured: boolean;
  initialError?: string | null;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(initialError ?? null);
  const invited = Boolean(invitationToken);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      // Si viene por invitación no se crea un negocio propio.
      businessName: invited ? "(por invitación)" : "",
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: RegisterInput) {
    setFormError(null);
    const { error } = await authClient.signUp.email({
      name: values.name,
      email: values.email,
      password: values.password,
    });
    if (error) {
      setFormError(translateAuthError(error));
      return;
    }

    if (invited && invitationToken) {
      router.push(`/invitacion/${encodeURIComponent(invitationToken)}`);
      router.refresh();
      return;
    }

    const result = await createOrganization({ name: values.businessName });
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card className="border-border/80 bg-card/95 shadow-[0_28px_70px_-42px_rgba(0,0,0,0.95)]">
      <AuthCardHeader
        eyebrow={invited ? "Invitación de equipo" : "Nuevo espacio de trabajo"}
        title="Crear cuenta"
        description={
          invited
            ? "Creá tu cuenta para unirte al equipo que te invitó."
            : "Registrá tu negocio y prepará tu espacio de trabajo."
        }
      />
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          <FormAlert message={formError} />
          <GoogleAuthButton
            mode="register"
            configured={googleConfigured}
            invitationToken={invitationToken}
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
            <Label htmlFor="name">Tu nombre</Label>
            <Input
              id="name"
              autoComplete="name"
              placeholder="Ana García"
              aria-invalid={Boolean(errors.name)}
              {...register("name")}
            />
            <FieldError message={errors.name?.message} />
          </div>
          {!invited && (
            <div className="space-y-2">
              <Label htmlFor="businessName">Nombre del negocio</Label>
              <Input
                id="businessName"
                autoComplete="organization"
                placeholder="Estética Aurora"
                aria-invalid={Boolean(errors.businessName)}
                {...register("businessName")}
              />
              <FieldError message={errors.businessName?.message} />
            </div>
          )}
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
            <Label htmlFor="password">Contraseña</Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres"
              aria-invalid={Boolean(errors.password)}
              {...register("password")}
            />
            <FieldError message={errors.password?.message} />
            <p className="text-xs text-muted-foreground">
              Mínimo 8 caracteres.
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex-col gap-4 pt-6">
          <SubmitButton loading={isSubmitting} className="w-full">
            Crear cuenta
          </SubmitButton>
          <p className="text-sm text-muted-foreground">
            ¿Ya tenés cuenta?{" "}
            <Link
              href="/login"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Iniciá sesión
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
