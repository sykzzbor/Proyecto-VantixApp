"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Cloud, KeyRound, Loader2, ShieldCheck } from "lucide-react";
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
  ycloudConnectionSchema,
  type YCloudConnectionInput,
} from "@/lib/validations/whatsapp";

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
    // Se reemplaza cualquier respuesta inesperada por un mensaje local seguro.
  }
  return "No se pudo completar la conexión con YCloud.";
}

export function YCloudConnectionDialog({
  onConnected,
  triggerLabel = "Conectar con YCloud",
}: {
  onConnected: () => void;
  triggerLabel?: "Conectar con YCloud" | "Reconectar YCloud";
}) {
  const [open, setOpen] = useState(false);
  const form = useForm<YCloudConnectionInput>({
    resolver: zodResolver(ycloudConnectionSchema),
    defaultValues: { apiKey: "", phoneNumber: "" },
  });

  function clearForm() {
    form.reset({ apiKey: "", phoneNumber: "" });
  }

  async function onSubmit(values: YCloudConnectionInput) {
    try {
      const response = await fetch("/api/integrations/whatsapp/ycloud", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        toast.error(await readSafeError(response));
        return;
      }
      clearForm();
      setOpen(false);
      toast.success("WhatsApp quedó conectado mediante YCloud Coexistence.");
      onConnected();
    } catch {
      toast.error("No se pudo conectar con el servidor. Volvé a intentarlo.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) clearForm();
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Cloud aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Conectar con YCloud</DialogTitle>
          <DialogDescription>
            Ingresá la API key y el número que ya completó el onboarding de
            Coexistence. Los identificadores del canal se consultan directamente
            a YCloud.
          </DialogDescription>
        </DialogHeader>

        <form
          id="ycloud-connection-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="ycloud-phone-number">Número de WhatsApp</Label>
            <Input
              id="ycloud-phone-number"
              inputMode="tel"
              autoComplete="off"
              placeholder="+5493515550000"
              aria-invalid={Boolean(form.formState.errors.phoneNumber)}
              {...form.register("phoneNumber")}
            />
            <FieldError message={form.formState.errors.phoneNumber?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ycloud-api-key">API key</Label>
            <div className="relative">
              <KeyRound
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="ycloud-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                className="pl-9"
                placeholder="Pegá la API key de YCloud"
                aria-invalid={Boolean(form.formState.errors.apiKey)}
                data-1p-ignore
                data-lpignore="true"
                {...form.register("apiKey")}
              />
            </div>
            <FieldError message={form.formState.errors.apiKey?.message} />
          </div>

          <div className="flex gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
            <p>
              La API key se envía solo al servidor, se cifra con AES-256-GCM y
              se borra del formulario al cerrarlo. Nunca vuelve al navegador.
            </p>
          </div>
        </form>

        <DialogFooter showCloseButton>
          <Button
            type="submit"
            form="ycloud-connection-form"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Cloud aria-hidden />
            )}
            {form.formState.isSubmitting ? "Validando con YCloud" : "Conectar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
