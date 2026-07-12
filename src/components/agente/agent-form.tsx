"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { AgentTone } from "@/generated/prisma/enums";
import {
  AGENT_TONE_LABELS,
  agentSettingsSchema,
  type AgentSettingsInput,
} from "@/lib/validations/agent";
import { saveAgentSettings } from "@/server/actions/agent";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/forms/field-error";
import { SubmitButton } from "@/components/forms/submit-button";

type AgentFormProps = {
  defaults: AgentSettingsInput;
  canEdit: boolean;
};

export function AgentForm({ defaults, canEdit }: AgentFormProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AgentSettingsInput>({
    resolver: zodResolver(agentSettingsSchema),
    defaultValues: defaults,
  });

  async function onSubmit(values: AgentSettingsInput) {
    const result = await saveAgentSettings(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Configuración del agente guardada.");
    reset(values);
  }

  const disabled = !canEdit;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border bg-background px-3 py-2.5 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          En esta etapa la inteligencia artificial todavía no está conectada.
          Lo que configures acá queda guardado y listo para cuando se integre
          el agente.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identidad del asistente</CardTitle>
          <CardDescription>
            Cómo se presenta y en qué tono le habla a tus clientes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="agent-name">Nombre del asistente</Label>
            <Input
              id="agent-name"
              disabled={disabled}
              placeholder="Aurora"
              {...register("assistantName")}
            />
            <FieldError message={errors.assistantName?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-tone">Tono de respuesta</Label>
            <Controller
              control={control}
              name="tone"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={disabled}
                >
                  <SelectTrigger id="agent-tone" className="w-full">
                    <SelectValue placeholder="Elegí un tono" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(AgentTone).map((tone) => (
                      <SelectItem key={tone} value={tone}>
                        {AGENT_TONE_LABELS[tone]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError message={errors.tone?.message} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mensajes</CardTitle>
          <CardDescription>
            Los textos exactos que va a usar el asistente en cada situación.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent-welcome">Mensaje de bienvenida</Label>
            <Textarea
              id="agent-welcome"
              rows={2}
              disabled={disabled}
              {...register("welcomeMessage")}
            />
            <FieldError message={errors.welcomeMessage?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-fallback">
              Mensaje cuando no encuentra información
            </Label>
            <Textarea
              id="agent-fallback"
              rows={2}
              disabled={disabled}
              {...register("fallbackMessage")}
            />
            <FieldError message={errors.fallbackMessage?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-handoff">
              Reglas de derivación{" "}
              <span className="font-normal text-muted-foreground">
                (opcional)
              </span>
            </Label>
            <Textarea
              id="agent-handoff"
              rows={3}
              disabled={disabled}
              placeholder="Cuándo debe derivar la conversación a una persona. Por ejemplo: reclamos, pedidos de turno, consultas de facturación."
              {...register("handoffRules")}
            />
            <FieldError message={errors.handoffRules?.message} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="agent-enabled" className="text-sm font-medium">
              Agente habilitado
            </Label>
            <p className="text-sm text-muted-foreground">
              Cuando se integre la IA, el asistente va a responder solo si está
              habilitado.
            </p>
          </div>
          <Controller
            control={control}
            name="enabled"
            render={({ field }) => (
              <Switch
                id="agent-enabled"
                checked={field.value}
                onCheckedChange={field.onChange}
                disabled={disabled}
              />
            )}
          />
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex justify-end">
          <SubmitButton loading={isSubmitting} disabled={!isDirty}>
            Guardar configuración
          </SubmitButton>
        </div>
      )}
    </form>
  );
}
