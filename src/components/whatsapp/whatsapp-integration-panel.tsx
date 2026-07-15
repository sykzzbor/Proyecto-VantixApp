"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleOff,
  Clipboard,
  KeyRound,
  Loader2,
  PlugZap,
  ShieldCheck,
  Unplug,
  Webhook,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FieldError } from "@/components/forms/field-error";
import { SubmitButton } from "@/components/forms/submit-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { cn } from "@/lib/utils";
import {
  whatsappIntegrationConfigSchema,
  type WhatsappIntegrationConfigInput,
} from "@/lib/validations/whatsapp";
import {
  disconnectWhatsappIntegration,
  saveWhatsappIntegration,
  testStoredWhatsappConnection,
} from "@/server/actions/whatsapp";
import type { WhatsappIntegrationView } from "@/server/whatsapp/integration";
import { WhatsappIcon } from "@/components/whatsapp/whatsapp-icon";

type WhatsappIntegrationPanelProps = {
  integration: WhatsappIntegrationView | null;
  webhookUrl: string | null;
  canManage: boolean;
};

type StatusTone = {
  label: string;
  description: string;
  icon: typeof CircleCheck;
  badgeVariant: "outline" | "destructive";
  accentClass: string;
  iconClass: string;
};

function getStatusTone(
  integration: WhatsappIntegrationView | null
): StatusTone {
  if (!integration || integration.status === "disconnected") {
    return {
      label: "Desconectado",
      description: integration
        ? "La configuración sigue guardada, pero el canal no está activo."
        : "Todavía no hay un número de WhatsApp vinculado a esta organización.",
      icon: CircleOff,
      badgeVariant: "outline",
      accentClass: "bg-muted-foreground/35",
      iconClass: "text-muted-foreground",
    };
  }
  if (integration.status === "error") {
    return {
      label: "Error",
      description:
        "La última comprobación falló. Revisá el detalle seguro y volvé a probar.",
      icon: CircleAlert,
      badgeVariant: "destructive",
      accentClass: "bg-destructive",
      iconClass: "text-destructive",
    };
  }
  return {
    label: "Conectado",
    description:
      "Meta confirmó las credenciales del número. La recepción empieza al suscribir el webhook.",
    icon: CircleCheck,
    badgeVariant: "outline",
    accentClass: "bg-emerald-500",
    iconClass: "text-emerald-600 dark:text-emerald-400",
  };
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "truncate text-sm font-medium",
          mono && "font-mono text-xs"
        )}
        title={value || undefined}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

export function WhatsappIntegrationPanel({
  integration,
  webhookUrl,
  canManage,
}: WhatsappIntegrationPanelProps) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const tone = getStatusTone(integration);
  const StatusIcon = tone.icon;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<WhatsappIntegrationConfigInput>({
    resolver: zodResolver(whatsappIntegrationConfigSchema),
    defaultValues: {
      wabaId: integration?.wabaId ?? "",
      phoneNumberId: integration?.phoneNumberId ?? "",
      accessToken: "",
    },
  });

  async function onSave(values: WhatsappIntegrationConfigInput) {
    const result = await saveWhatsappIntegration(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(
      integration
        ? "Configuración de WhatsApp actualizada."
        : "WhatsApp quedó conectado."
    );
    reset({
      wabaId: values.wabaId,
      phoneNumberId: values.phoneNumberId,
      accessToken: "",
    });
    router.refresh();
  }

  async function onTestConnection() {
    setTesting(true);
    const result = await testStoredWhatsappConnection();
    setTesting(false);
    if (!result.ok) {
      toast.error(result.error);
      router.refresh();
      return;
    }
    toast.success("Conexión con WhatsApp verificada.");
    router.refresh();
  }

  async function onDisconnect() {
    setDisconnecting(true);
    const result = await disconnectWhatsappIntegration();
    setDisconnecting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDisconnectOpen(false);
    toast.success("WhatsApp fue desconectado.");
    router.refresh();
  }

  async function copyWebhookUrl() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast.success("URL del webhook copiada.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("No se pudo copiar la URL. Seleccionala manualmente.");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="relative">
        <div
          aria-hidden
          className={cn("absolute inset-x-0 top-0 h-1", tone.accentClass)}
        />
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted",
                  tone.iconClass
                )}
              >
                <StatusIcon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 space-y-1">
                <CardTitle>Estado del canal</CardTitle>
                <CardDescription>{tone.description}</CardDescription>
              </div>
            </div>
            <Badge
              variant={tone.badgeVariant}
              className={cn(
                integration?.status === "connected" &&
                  "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              )}
            >
              {tone.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <DetailItem
              label="Número"
              value={integration?.displayPhoneNumber}
            />
            <DetailItem
              label="Nombre verificado"
              value={integration?.verifiedName}
            />
            <DetailItem
              label="Phone Number ID"
              value={integration?.phoneNumberId}
              mono
            />
            <DetailItem label="WABA ID" value={integration?.wabaId} mono />
            <DetailItem
              label="Conectado desde"
              value={integration?.connectedAtLabel}
            />
            <DetailItem
              label="Última actividad"
              value={integration?.lastWebhookAtLabel}
            />
            <DetailItem
              label="Última actualización"
              value={integration?.updatedAtLabel}
            />
          </dl>

          {integration?.lastError && (
            <div
              role="alert"
              className="flex gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">Error reciente</p>
                <p className="mt-0.5 text-xs leading-relaxed">
                  {integration.lastError}
                </p>
              </div>
            </div>
          )}

          {canManage && integration && (
            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={onTestConnection}
                disabled={testing || disconnecting}
              >
                {testing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <PlugZap className="size-4" aria-hidden />
                )}
                Probar conexión
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => setDisconnectOpen(true)}
                disabled={
                  testing ||
                  disconnecting ||
                  integration.status === "disconnected"
                }
              >
                <Unplug className="size-4" aria-hidden />
                Desconectar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <WhatsappIcon className="size-5" />
              </span>
              <div className="space-y-1">
                <CardTitle>Credenciales de Meta</CardTitle>
                <CardDescription>
                  Vantix valida el número antes de cifrar y guardar el token.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {canManage ? (
              <form
                onSubmit={handleSubmit(onSave)}
                className="space-y-4"
                noValidate
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="whatsapp-waba-id">WABA ID</Label>
                    <Input
                      id="whatsapp-waba-id"
                      inputMode="numeric"
                      placeholder="123456789012345"
                      aria-invalid={Boolean(errors.wabaId)}
                      {...register("wabaId")}
                    />
                    <FieldError message={errors.wabaId?.message} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="whatsapp-phone-number-id">
                      Phone Number ID
                    </Label>
                    <Input
                      id="whatsapp-phone-number-id"
                      inputMode="numeric"
                      placeholder="123456789012345"
                      aria-invalid={Boolean(errors.phoneNumberId)}
                      {...register("phoneNumberId")}
                    />
                    <FieldError message={errors.phoneNumberId?.message} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="whatsapp-access-token">
                    Access token permanente
                  </Label>
                  <div className="relative">
                    <KeyRound
                      className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      id="whatsapp-access-token"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      className="pl-8"
                      placeholder="Pegá un token nuevo"
                      aria-invalid={Boolean(errors.accessToken)}
                      aria-describedby="whatsapp-token-help"
                      {...register("accessToken")}
                    />
                  </div>
                  <p
                    id="whatsapp-token-help"
                    className="text-xs leading-relaxed text-muted-foreground"
                  >
                    El campo siempre aparece vacío. Guardar reemplaza el token
                    anterior; después solo se muestra enmascarado.
                  </p>
                  <FieldError message={errors.accessToken?.message} />
                </div>

                <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ShieldCheck className="size-4" aria-hidden />
                    El token se cifra y nunca vuelve al navegador.
                  </p>
                  <SubmitButton loading={isSubmitting} className="sm:self-end">
                    {integration ? "Guardar credenciales" : "Conectar WhatsApp"}
                  </SubmitButton>
                </div>
              </form>
            ) : (
              <div className="rounded-lg border border-dashed p-4">
                <p className="text-sm font-medium">Configuración de solo lectura</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Solo propietarios y administradores pueden cambiar IDs o
                  reemplazar el access token. Tu rol puede consultar el estado
                  del canal sin acceder a la credencial.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Webhook className="size-5" aria-hidden />
              </span>
              <div className="space-y-1">
                <CardTitle>Webhook oficial</CardTitle>
                <CardDescription>
                  Usá esta URL como callback en tu aplicación de Meta.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="whatsapp-webhook-url">URL del webhook</Label>
              <div className="flex gap-2">
                <Input
                  id="whatsapp-webhook-url"
                  value={webhookUrl ?? "No disponible"}
                  readOnly
                  className="font-mono text-xs"
                  aria-describedby="whatsapp-webhook-help"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyWebhookUrl}
                  disabled={!webhookUrl}
                  aria-label={copied ? "URL copiada" : "Copiar URL del webhook"}
                >
                  {copied ? (
                    <Check className="size-4" aria-hidden />
                  ) : (
                    <Clipboard className="size-4" aria-hidden />
                  )}
                </Button>
              </div>
              <p
                id="whatsapp-webhook-help"
                className="text-xs leading-relaxed text-muted-foreground"
              >
                En producción, Meta necesita una URL pública con HTTPS.
              </p>
            </div>

            {!webhookUrl && (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                Configurá una URL válida del servidor para poder registrar el
                callback en Meta.
              </div>
            )}

            <div className="border-t pt-4">
              <h3 className="text-sm font-medium">Configuración en Meta</h3>
              <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
                <li className="flex gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
                    1
                  </span>
                  <span className="min-w-0 leading-relaxed">
                    Pegá la URL como callback de WhatsApp.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
                    2
                  </span>
                  <span className="min-w-0 leading-relaxed">
                    Usá el valor de <code>WHATSAPP_VERIFY_TOKEN</code> configurado
                    en el servidor.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
                    3
                  </span>
                  <span className="min-w-0 leading-relaxed">
                    Suscribí el campo <code>messages</code> del número.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
                    4
                  </span>
                  <span className="min-w-0 leading-relaxed">
                    Volvé a Vantix y probá la conexión guardada.
                  </span>
                </li>
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desconectar WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              Vantix conservará la configuración cifrada y el historial, pero
              no podrá enviar mensajes hasta volver a probar la conexión.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disconnecting}
              onClick={(event) => {
                event.preventDefault();
                void onDisconnect();
              }}
            >
              {disconnecting && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
