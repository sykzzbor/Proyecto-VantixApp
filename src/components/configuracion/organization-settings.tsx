"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  renameOrganizationSchema,
  type RenameOrganizationInput,
} from "@/lib/validations/business";
import {
  deleteOrganization,
  renameOrganization,
} from "@/server/actions/organization";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
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
  canDelete: boolean;
};

export function OrganizationSettings({
  orgName,
  canUpdate,
  canDelete,
}: OrganizationSettingsProps) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  async function onDelete() {
    setDeleting(true);
    const result = await deleteOrganization();
    setDeleting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("La organización fue eliminada.");
    router.push("/onboarding");
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

      {canDelete && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <TriangleAlert className="size-4" />
              Zona de peligro
            </CardTitle>
            <CardDescription>
              Eliminar la organización borra de forma permanente el negocio,
              los productos, los servicios, las preguntas, el equipo y toda la
              actividad.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog
              open={deleteOpen}
              onOpenChange={(open) => {
                setDeleteOpen(open);
                if (!open) setConfirmText("");
              }}
            >
              <AlertDialogTrigger asChild>
                <Button variant="destructive">Eliminar organización</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    ¿Eliminar {orgName} de forma permanente?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta acción no se puede deshacer. Para confirmar, escribí el
                    nombre exacto de la organización.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="confirm-org-name" className="sr-only">
                    Nombre de la organización
                  </Label>
                  <Input
                    id="confirm-org-name"
                    placeholder={orgName}
                    value={confirmText}
                    onChange={(event) => setConfirmText(event.target.value)}
                    autoComplete="off"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>
                    Cancelar
                  </AlertDialogCancel>
                  <Button
                    variant="destructive"
                    disabled={confirmText !== orgName || deleting}
                    onClick={(event) => {
                      event.preventDefault();
                      onDelete();
                    }}
                  >
                    {deleting && (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    )}
                    Eliminar definitivamente
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
