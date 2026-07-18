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
    <Card className="border-0 bg-transparent shadow-none">
      <CardHeader className="px-0">
        <CardTitle className="text-xl">
          Hola {userName.split(" ")[0]}, empecemos
        </CardTitle>
        <CardDescription>
          Asignale un nombre al espacio donde vas a gestionar clientes, equipo e integraciones.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-5 px-0">
          <FormAlert message={formError} />
          <div className="space-y-2">
            <Label htmlFor="name">Nombre del negocio</Label>
            <Input
              id="name"
              placeholder="Estética Aurora"
              autoFocus
              {...register("name")}
            />
            <FieldError message={errors.name?.message} />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Podés cambiarlo más adelante desde Configuración. No tiene que coincidir con el nombre público del negocio.
            </p>
          </div>
        </CardContent>
        <CardFooter className="mt-6 flex-col gap-3 border-0 bg-transparent px-0 pt-0">
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
