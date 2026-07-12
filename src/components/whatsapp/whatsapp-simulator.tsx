"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCheck,
  CircleCheck,
  CircleX,
  FlaskConical,
  Loader2,
  MessageSquareText,
  Send,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FieldError } from "@/components/forms/field-error";
import { SubmitButton } from "@/components/forms/submit-button";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import {
  whatsappSimulatorMessageSchema,
  type WhatsappSimulatorMessageInput,
} from "@/lib/validations/whatsapp";
import {
  simulateWhatsappIncoming,
  simulateWhatsappStatus,
} from "@/server/actions/whatsapp-simulator";

type WhatsappSimulatorProps = {
  organizationName: string;
};

type SimulatedStatus = "sent" | "delivered" | "read" | "failed";

const STATUS_BUTTONS: Array<{
  status: SimulatedStatus;
  label: string;
  icon: typeof Send;
  variant: "outline" | "destructive";
}> = [
  { status: "sent", label: "sent", icon: Send, variant: "outline" },
  {
    status: "delivered",
    label: "delivered",
    icon: CircleCheck,
    variant: "outline",
  },
  { status: "read", label: "read", icon: CheckCheck, variant: "outline" },
  { status: "failed", label: "failed", icon: CircleX, variant: "destructive" },
];

function createSimulatedExternalId() {
  return `wamid.simulated.ui.${crypto.randomUUID()}`;
}

export function WhatsappSimulator({
  organizationName,
}: WhatsappSimulatorProps) {
  const router = useRouter();
  const [lastInboundId, setLastInboundId] = useState<string | null>(null);
  const [outboundId, setOutboundId] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState<SimulatedStatus | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<WhatsappSimulatorMessageInput>({
    resolver: zodResolver(whatsappSimulatorMessageSchema),
    defaultValues: {
      name: "Cliente de prueba",
      phone: "+5491112345678",
      message: "",
    },
  });

  async function onIncoming(values: WhatsappSimulatorMessageInput) {
    const result = await simulateWhatsappIncoming(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setLastInboundId(result.externalMessageId);
    reset({ ...values, message: "" });
    toast.success("Mensaje entrante agregado a la bandeja.");
    router.refresh();
  }

  async function onStatus(status: SimulatedStatus) {
    if ((status === "delivered" || status === "read") && !outboundId) {
      toast.error("Simulá primero el estado sent.");
      return;
    }

    const externalMessageId =
      status === "sent" || status === "failed"
        ? createSimulatedExternalId()
        : outboundId ?? createSimulatedExternalId();

    setStatusBusy(status);
    const result = await simulateWhatsappStatus({
      externalMessageId,
      status,
      errorCode: status === "failed" ? "SIMULATED" : undefined,
      errorMessage:
        status === "failed" ? "Fallo de entrega simulado desde Vantix." : undefined,
    });
    setStatusBusy(null);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setOutboundId(result.externalMessageId);
    toast.success(`Estado ${status} aplicado.`);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <FlaskConical className="size-5" aria-hidden />
            </span>
            <div className="space-y-1">
              <CardTitle>Simulador de webhook</CardTitle>
              <CardDescription>
                Probá el flujo de la bandeja sin credenciales ni envíos reales.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline">Solo desarrollo</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={handleSubmit(onIncoming)}
            className="space-y-4"
            noValidate
          >
            <div>
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <MessageSquareText className="size-4" aria-hidden />
                Mensaje entrante
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Crea o reutiliza cliente y conversación usando el mismo servicio
                interno del webhook.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="simulator-organization">
                Organización seleccionada
              </Label>
              <Input
                id="simulator-organization"
                value={organizationName}
                readOnly
                disabled
              />
              <p className="text-xs text-muted-foreground">
                Se resuelve desde tu sesión; no se envía un ID desde el navegador.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="simulator-name">Nombre ficticio</Label>
                <Input
                  id="simulator-name"
                  autoComplete="off"
                  aria-invalid={Boolean(errors.name)}
                  {...register("name")}
                />
                <FieldError message={errors.name?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="simulator-phone">Teléfono ficticio</Label>
                <Input
                  id="simulator-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="+5491112345678"
                  aria-invalid={Boolean(errors.phone)}
                  {...register("phone")}
                />
                <FieldError message={errors.phone?.message} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="simulator-message">Mensaje</Label>
              <Textarea
                id="simulator-message"
                rows={4}
                placeholder="Escribí un mensaje que quieras ver en la bandeja"
                aria-invalid={Boolean(errors.message)}
                {...register("message")}
              />
              <FieldError message={errors.message?.message} />
            </div>

            <SubmitButton loading={isSubmitting}>
              Simular mensaje entrante
            </SubmitButton>

            {lastInboundId && (
              <div className="rounded-lg bg-muted/60 p-3" aria-live="polite">
                <p className="text-xs font-medium">Último mensaje entrante</p>
                <code className="mt-1 block break-all text-[11px] text-muted-foreground">
                  {lastInboundId}
                </code>
              </div>
            )}
          </form>

          <section className="space-y-4 border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
            <div>
              <h3 className="text-sm font-medium">Estados de entrega</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                <code>sent</code> inicia un mensaje saliente nuevo; los estados
                siguientes reutilizan su ID.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="simulator-external-id">
                External message ID activo
              </Label>
              <Input
                id="simulator-external-id"
                value={outboundId ?? "Se genera al simular sent o failed"}
                readOnly
                className="font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {STATUS_BUTTONS.map((item) => {
                const Icon = item.icon;
                const loading = statusBusy === item.status;
                const needsExisting =
                  item.status === "delivered" || item.status === "read";
                return (
                  <Button
                    key={item.status}
                    type="button"
                    variant={item.variant}
                    onClick={() => onStatus(item.status)}
                    disabled={
                      statusBusy !== null || (needsExisting && !outboundId)
                    }
                    className="font-mono text-xs"
                  >
                    {loading ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Icon className="size-4" aria-hidden />
                    )}
                    {item.label}
                  </Button>
                );
              })}
            </div>

            <div className="rounded-lg border border-dashed p-4 text-xs leading-relaxed text-muted-foreground">
              <p className="font-medium text-foreground">Secuencia sugerida</p>
              <p className="mt-1">
                Simulá un mensaje entrante, luego ejecutá <code>sent</code>,
                <code> delivered</code> y <code> read</code>. Para probar un
                error independiente, usá <code>failed</code> sin una secuencia
                activa o volvé a iniciar con <code>sent</code>.
              </p>
            </div>

            <p className="text-xs text-muted-foreground" aria-live="polite">
              {statusBusy
                ? `Aplicando estado ${statusBusy}…`
                : "El simulador nunca llama a Meta ni envía mensajes a números reales."}
            </p>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
