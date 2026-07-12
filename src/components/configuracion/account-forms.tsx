"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { translateAuthError } from "@/lib/auth-errors";
import {
  changePasswordSchema,
  type ChangePasswordInput,
} from "@/lib/validations/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/forms/field-error";
import { SubmitButton } from "@/components/forms/submit-button";

const nameSchema = z.object({
  name: z
    .string()
    .min(2, "Ingresá tu nombre completo.")
    .max(80, "El nombre es demasiado largo."),
});

type NameInput = z.infer<typeof nameSchema>;

export function ProfileNameForm({ currentName }: { currentName: string }) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<NameInput>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: currentName },
  });

  async function onSubmit(values: NameInput) {
    const { error } = await authClient.updateUser({ name: values.name });
    if (error) {
      toast.error(translateAuthError(error));
      return;
    }
    toast.success("Nombre actualizado.");
    reset(values);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      noValidate
    >
      <div className="flex-1 space-y-2">
        <Label htmlFor="account-name">Nombre</Label>
        <Input id="account-name" autoComplete="name" {...register("name")} />
        <FieldError message={errors.name?.message} />
      </div>
      <SubmitButton
        loading={isSubmitting}
        disabled={!isDirty}
        variant="outline"
      >
        Guardar
      </SubmitButton>
    </form>
  );
}

export function ChangePasswordForm() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: ChangePasswordInput) {
    const { error } = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    });
    if (error) {
      toast.error(translateAuthError(error));
      return;
    }
    toast.success("Contraseña actualizada.");
    reset();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="current-password">Contraseña actual</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            {...register("currentPassword")}
          />
          <FieldError message={errors.currentPassword?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-password">Nueva contraseña</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            {...register("newPassword")}
          />
          <FieldError message={errors.newPassword?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Repetir contraseña</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            {...register("confirmPassword")}
          />
          <FieldError message={errors.confirmPassword?.message} />
        </div>
      </div>
      <div className="flex justify-end">
        <SubmitButton loading={isSubmitting} variant="outline">
          Cambiar contraseña
        </SubmitButton>
      </div>
    </form>
  );
}
