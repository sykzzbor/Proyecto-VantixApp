"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { authClient } from "@/lib/auth-client";
import { translateAuthError } from "@/lib/auth-errors";
import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from "@/lib/validations/auth";
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

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onSubmit(values: ResetPasswordInput) {
    setFormError(null);
    const { error } = await authClient.resetPassword({
      newPassword: values.password,
      token,
    });
    if (error) {
      setFormError(translateAuthError(error));
      return;
    }
    toast.success("Contraseña actualizada. Ya podés iniciar sesión.");
    router.push("/login");
  }

  return (
    <Card className="border-border/80 bg-card/95 shadow-[0_28px_70px_-42px_rgba(0,0,0,0.95)]">
      <AuthCardHeader
        eyebrow="Seguridad de la cuenta"
        title="Nueva contraseña"
        description="Elegí una contraseña nueva para tu cuenta."
      />
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          <FormAlert message={formError} />
          <div className="space-y-2">
            <Label htmlFor="password">Nueva contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="Mínimo 10 caracteres"
              aria-invalid={Boolean(errors.password)}
              {...register("password")}
            />
            <FieldError message={errors.password?.message} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Repetir contraseña</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Repetí la contraseña"
              aria-invalid={Boolean(errors.confirmPassword)}
              {...register("confirmPassword")}
            />
            <FieldError message={errors.confirmPassword?.message} />
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <SubmitButton loading={isSubmitting} className="w-full">
            Guardar contraseña
          </SubmitButton>
        </CardFooter>
      </form>
    </Card>
  );
}
