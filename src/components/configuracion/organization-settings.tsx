"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  renameOrganizationSchema,
  type RenameOrganizationInput,
} from "@/lib/validations/business";
import { renameOrganization } from "@/server/actions/organization";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/forms/field-error";
import { SubmitButton } from "@/components/forms/submit-button";
import { ReadOnlyNotice } from "@/components/dashboard/read-only-notice";

type OrganizationSettingsProps = {
  orgName: string;
  canUpdate: boolean;
};

export function OrganizationSettings({
  orgName,
  canUpdate,
}: OrganizationSettingsProps) {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<RenameOrganizationInput>({
    resolver: zodResolver(renameOrganizationSchema),
    defaultValues: { name: orgName },
  });

  async function onRename(values: RenameOrganizationInput) {
    const result = await renameOrganization(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Organización renombrada.");
    reset(values);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {!canUpdate && (
        <ReadOnlyNotice message="Podés consultar la organización, pero tu rol no permite cambiar su configuración." />
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organización</CardTitle>
          <CardDescription>
            El nombre interno del espacio de trabajo. El nombre público del
            negocio se edita en la sección Negocio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit(onRename)}
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            noValidate
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="org-name">Nombre de la organización</Label>
              <Input
                id="org-name"
                disabled={!canUpdate}
                {...register("name")}
              />
              <FieldError message={errors.name?.message} />
            </div>
            {canUpdate && (
              <SubmitButton
                loading={isSubmitting}
                disabled={!isDirty}
                variant="outline"
              >
                Guardar
              </SubmitButton>
            )}
          </form>
        </CardContent>
      </Card>

    </div>
  );
}
