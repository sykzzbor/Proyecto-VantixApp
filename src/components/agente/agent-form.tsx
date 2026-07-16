"use client";

import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Bot,
  CircleCheckBig,
  CircleDashed,
  MessagesSquare,
  Power,
  Route,
  ShieldCheck,
  UserRound,
} from "lucide-react";
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
  CardFooter,
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
import { FormSection } from "@/components/dashboard/form-section";
import { ReadOnlyNotice } from "@/components/dashboard/read-only-notice";

type AgentFormProps = {
  defaults: AgentSettingsInput;
  canEdit: boolean;
  configured: boolean;
};

export function AgentForm({ defaults, canEdit, configured }: AgentFormProps) {
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
  const enabled = useWatch({ control, name: "enabled" });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {!canEdit && (
        <ReadOnlyNotice message="Podés revisar y probar el agente, pero tu rol no permite cambiar su configuración." />
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-4">
          <FormSection
            icon={UserRound}
            title="Identidad"
            description="Cómo se presenta y qué tono mantiene durante la conversación."
          >
            <div className="grid gap-4 sm:grid-cols-2">
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
            </div>
          </FormSection>

          <FormSection
            icon={MessagesSquare}
            title="Respuestas base"
            description="Los mensajes que abren la conversación y cubren una consulta sin respuesta."
          >
            <div className="grid gap-4 lg:grid-cols-2">
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
            </div>
          </FormSection>

          <FormSection
            icon={Route}
            title="Derivación humana"
            description="Indicá cuándo el agente debe dejar la conversación en manos del equipo."
          >
            <div className="space-y-2">
            <Label htmlFor="agent-handoff">
              Criterios de derivación <span className="font-normal text-muted-foreground">(opcional)</span>
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
          </FormSection>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20">
          <Card>
            <CardHeader>
              <div className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
                <Power className="size-4 text-[#8eacff]" aria-hidden />
              </div>
              <CardTitle className="mt-2 text-base">Estado operativo</CardTitle>
              <CardDescription>
                Controlá si el agente puede responder conversaciones nuevas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border/75 bg-background/35 p-3">
                <div>
                  <Label htmlFor="agent-enabled" className="text-sm font-medium">
                    Respuestas automáticas
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {enabled ? "Activadas" : "Pausadas"}
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
              </div>
              <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
                {configured ? (
                  <CircleCheckBig className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden />
                ) : (
                  <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
                )}
                <p>
                  {configured
                    ? "El proveedor de IA está disponible para las pruebas y respuestas."
                    : "La configuración del proveedor de IA todavía no está completa."}
                </p>
              </div>
            </CardContent>
            {canEdit && (
              <CardFooter>
                <SubmitButton loading={isSubmitting} disabled={!isDirty} className="w-full">
                  Guardar configuración
                </SubmitButton>
              </CardFooter>
            )}
          </Card>

          <Card size="sm">
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#8eacff]" aria-hidden />
                <div>
                  <p className="text-sm font-medium">Control seguro</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    El agente usa únicamente la información habilitada del negocio y deriva cuando se cumplen estas reglas.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Bot className="size-3.5" aria-hidden />
                Probalo antes de atender clientes reales.
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </form>
  );
}
