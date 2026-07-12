"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { authClient } from "@/lib/auth-client";
import {
  forgotPasswordSchema,
  type ForgotPasswordInput,
} from "@/lib/validations/auth";
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
import { SubmitButton } from "@/components/forms/submit-button";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: ForgotPasswordInput) {
    await authClient.requestPasswordReset({
      email: values.email,
      redirectTo: "/restablecer-password",
    });
    // Siempre se muestra el mismo mensaje para no revelar qué emails existen.
    setSent(true);
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
            <MailCheck className="size-5 text-muted-foreground" aria-hidden />
          </div>
          <CardTitle className="text-xl">Revisá tu correo</CardTitle>
          <CardDescription>
            Si existe una cuenta con ese email, te enviamos un enlace para
            restablecer la contraseña. El enlace vence en 1 hora.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Nota de esta etapa: el envío de emails todavía no está integrado.
            En desarrollo, el enlace aparece en la consola del servidor.
          </p>
        </CardContent>
        <CardFooter>
          <Link
            href="/login"
            className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            Volver a iniciar sesión
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Recuperar contraseña</CardTitle>
        <CardDescription>
          Ingresá el email de tu cuenta y te enviaremos un enlace para crear
          una contraseña nueva.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
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
        </CardContent>
        <CardFooter className="flex-col gap-4 pt-6">
          <SubmitButton loading={isSubmitting} className="w-full">
            Enviar enlace
          </SubmitButton>
          <Link
            href="/login"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Volver a iniciar sesión
          </Link>
        </CardFooter>
      </form>
    </Card>
  );
}
