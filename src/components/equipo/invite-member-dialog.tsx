"use client";

import { useEffect } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import type { MemberRole } from "@/generated/prisma/enums";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/permissions";
import {
  inviteMemberSchema,
  type InviteMemberInput,
} from "@/lib/validations/team";
import { inviteMember } from "@/server/actions/team";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldError } from "@/components/forms/field-error";
import { SubmitButton } from "@/components/forms/submit-button";

type InviteMemberDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: MemberRole[];
};

export function InviteMemberDialog({
  open,
  onOpenChange,
  roles,
}: InviteMemberDialogProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteMemberInput>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: "", role: "VIEWER" },
  });

  useEffect(() => {
    if (open) reset({ email: "", role: "VIEWER" });
  }, [open, reset]);

  const selectedRole = useWatch({ control, name: "role" });

  async function onSubmit(values: InviteMemberInput) {
    const result = await inviteMember(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      "Invitación creada. Copiá el enlace desde la lista y compartilo."
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invitar a una persona</DialogTitle>
          <DialogDescription>
            Se genera un enlace de invitación válido por 7 días para el email
            indicado.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="persona@empresa.com"
              {...register("email")}
            />
            <FieldError message={errors.email?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-role">Rol</Label>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="invite-role" className="w-full">
                    <SelectValue placeholder="Elegí un rol" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-xs text-muted-foreground">
              {ROLE_DESCRIPTIONS[selectedRole]}
            </p>
            <FieldError message={errors.role?.message} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <SubmitButton loading={isSubmitting}>
              Crear invitación
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
