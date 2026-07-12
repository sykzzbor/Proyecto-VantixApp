"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { authClient } from "@/lib/auth-client";
import {
  createOrganizationSchema,
  type CreateOrganizationInput,
} from "@/lib/validations/business";
import { createOrganization } from "@/server/actions/organization";
import { Button } from "@/components/ui/button";
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

export function CreateOrganizationForm({ userName }: { userName: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: "" },
  });

  async function onSubmit(values: CreateOrganizationInput) {
    setFormError(null);
    const result = await createOrganization(values);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          Hola {userName.split(" ")[0]}, creá tu negocio
        </CardTitle>
        <CardDescription>
          Tu cuenta todavía no pertenece a ningún negocio. Creá el tuyo para
          empezar, o pedile a tu equipo que te envíe una invitación.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          <FormAlert message={formError} />
          <div className="space-y-2">
            <Label htmlFor="name">Nombre del negocio</Label>
            <Input
              id="name"
              placeholder="Estética Aurora"
              {...register("name")}
            />
            <FieldError message={errors.name?.message} />
          </div>
        </CardContent>
        <CardFooter className="flex-col gap-3 pt-6">
          <SubmitButton loading={isSubmitting} className="w-full">
            Crear negocio
          </SubmitButton>
          <Button
            type="button"
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={handleSignOut}
          >
            Cerrar sesión
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
