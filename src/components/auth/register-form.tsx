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
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/forms/field-error";
import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";

export function RegisterForm({
  invitationToken,
}: {
  invitationToken?: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
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
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Crear cuenta</CardTitle>
        <CardDescription>
          {invited
            ? "Creá tu cuenta para unirte al equipo que te invitó."
            : "Registrá tu negocio y empezá a gestionarlo en minutos."}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          <FormAlert message={formError} />
          <div className="space-y-2">
            <Label htmlFor="name">Tu nombre</Label>
            <Input
              id="name"
              autoComplete="name"
              placeholder="Ana García"
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
              {...register("email")}
            />
            <FieldError message={errors.email?.message} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
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
