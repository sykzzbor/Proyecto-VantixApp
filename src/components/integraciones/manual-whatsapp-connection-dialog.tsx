"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Link2, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FieldError } from "@/components/forms/field-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  whatsappIntegrationConfigSchema,
  type WhatsappIntegrationConfigInput,
} from "@/lib/validations/whatsapp";

type ManualWhatsappConnectionDialogProps = {
  onConnected: () => void;
  triggerLabel?: "Conectar manualmente" | "Reconectar";
};

async function readSafeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (
      typeof body.message === "string" &&
      body.message.length > 0 &&
      body.message.length <= 300
    ) {
      return body.message;
    }
  } catch {
    // La respuesta inválida se reemplaza por un mensaje local y seguro.
  }
  return "No se pudo completar la conexión manual con WhatsApp.";
}

export function ManualWhatsappConnectionDialog({
  onConnected,
  triggerLabel = "Conectar manualmente",
}: ManualWhatsappConnectionDialogProps) {
  const [open, setOpen] = useState(false);
  const form = useForm<WhatsappIntegrationConfigInput>({
    resolver: zodResolver(whatsappIntegrationConfigSchema),
    defaultValues: { wabaId: "", phoneNumberId: "", accessToken: "" },
  });

  function resetSensitiveForm() {
    form.reset({ wabaId: "", phoneNumberId: "", accessToken: "" });
  }

  async function onSubmit(values: WhatsappIntegrationConfigInput) {
    try {
      const response = await fetch("/api/integrations/whatsapp/manual", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        toast.error(await readSafeError(response));
        return;
      }
      resetSensitiveForm();
      setOpen(false);
      toast.success("WhatsApp quedó conectado manualmente.");
      onConnected();
    } catch {
      toast.error("No se pudo conectar con el servidor. Volvé a intentarlo.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) resetSensitiveForm();
        setOpen(open);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Link2 aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp manualmente</DialogTitle>
          <DialogDescription>
            Ingresá los identificadores de WhatsApp Cloud API y un token de
            larga duración. VantixApp validará los activos con Meta antes de
            guardar la conexión.
          </DialogDescription>
        </DialogHeader>

        <form
          id="manual-whatsapp-connection-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="manual-whatsapp-waba-id">WABA ID</Label>
              <Input
                id="manual-whatsapp-waba-id"
                inputMode="numeric"
                autoComplete="off"
                placeholder="123456789012345"
                aria-invalid={Boolean(form.formState.errors.wabaId)}
                {...form.register("wabaId")}
              />
              <FieldError message={form.formState.errors.wabaId?.message} />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="manual-whatsapp-phone-number-id">
                Phone Number ID
              </Label>
              <Input
                id="manual-whatsapp-phone-number-id"
                inputMode="numeric"
                autoComplete="off"
                placeholder="123456789012345"
                aria-invalid={Boolean(form.formState.errors.phoneNumberId)}
                {...form.register("phoneNumberId")}
              />
              <FieldError
                message={form.formState.errors.phoneNumberId?.message}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-whatsapp-access-token">
              Access token permanente o de larga duración
            </Label>
            <div className="relative">
              <KeyRound
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="manual-whatsapp-access-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                className="pl-9"
                placeholder="Pegá el token de Meta"
                aria-invalid={Boolean(form.formState.errors.accessToken)}
                data-1p-ignore
                data-lpignore="true"
                {...form.register("accessToken")}
              />
            </div>
            <FieldError message={form.formState.errors.accessToken?.message} />
          </div>

          <div className="flex gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
            <p>
              El token se envía solo al servidor, se cifra con AES-256-GCM y
              se elimina del formulario al cerrarlo. Nunca vuelve en la
              respuesta.
            </p>
          </div>
        </form>

        <DialogFooter showCloseButton>
          <Button
            type="submit"
            form="manual-whatsapp-connection-form"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Link2 aria-hidden />
            )}
            {form.formState.isSubmitting ? "Validando con Meta" : "Conectar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
