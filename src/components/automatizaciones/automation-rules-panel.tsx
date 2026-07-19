"use client";

import { useState } from "react";
import {
  BellRing,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MessageCircleMore,
  PauseCircle,
  Save,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  automationRuleUpdateSchema,
  followUpRuleConfigSchema,
  renderFollowUpMessage,
  type FollowUpRuleConfig,
  type HandoffRuleConfig,
  type ParsedHandoffRuleConfig,
} from "@/lib/validations/automation-rules";
import type {
  AutomationRuleView,
  AutomationRuleVisualState,
} from "@/server/automation/rules";

const DAY_OPTIONS = [
  [1, "Lun"],
  [2, "Mar"],
  [3, "Mié"],
  [4, "Jue"],
  [5, "Vie"],
  [6, "Sáb"],
  [7, "Dom"],
] as const;

const STATE_META: Record<
  AutomationRuleVisualState,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  ACTIVE: {
    label: "Activa",
    icon: Sparkles,
    className: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  PAUSED: {
    label: "Pausada",
    icon: PauseCircle,
    className: "border-border bg-muted text-muted-foreground",
  },
  INCOMPLETE: {
    label: "Incompleta",
    icon: TriangleAlert,
    className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  ERROR: {
    label: "Con error",
    icon: ShieldAlert,
    className: "border-destructive/25 bg-destructive/10 text-destructive",
  },
  WORKING: {
    label: "Funcionando",
    icon: CheckCircle2,
    className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
};

function formatDateTime(value: string | null) {
  if (!value) return "Sin ejecuciones todavía";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function RuleState({ state }: { state: AutomationRuleVisualState }) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={meta.className}>
      <Icon />
      {meta.label}
    </Badge>
  );
}

function ExecutionSummary({ rule }: { rule: AutomationRuleView }) {
  return (
    <div className="grid gap-1 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
      <span>
        Última ejecución: <strong className="text-foreground">{formatDateTime(rule.lastExecutionAt)}</strong>
      </span>
      {rule.lastError && (
        <span className="break-words text-destructive">Último error: {rule.lastError}</span>
      )}
    </div>
  );
}

async function saveRule(body: unknown): Promise<AutomationRuleView> {
  const response = await fetch("/api/automation/rules", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as {
    rule?: AutomationRuleView;
    message?: string;
  };
  if (!response.ok || !result.rule) {
    throw new Error(result.message ?? "No se pudo guardar la regla.");
  }
  return result.rule;
}

function HandoffRuleCard({
  initialRule,
  canManage,
}: {
  initialRule: AutomationRuleView;
  canManage: boolean;
}) {
  const [rule, setRule] = useState(initialRule);
  const [enabled, setEnabled] = useState(initialRule.enabled);
  const initialConfig = initialRule.config as ParsedHandoffRuleConfig;
  const [recipients, setRecipients] = useState<HandoffRuleConfig["recipients"]>(
    initialConfig.recipients
  );
  const [phoneNumbers, setPhoneNumbers] = useState(
    initialConfig.phoneNumbers.join("\n")
  );
  const [templateName, setTemplateName] = useState(initialConfig.templateName);
  const [templateLanguage, setTemplateLanguage] = useState<
    ParsedHandoffRuleConfig["templateLanguage"]
  >(initialConfig.templateLanguage);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const update = automationRuleUpdateSchema.safeParse({
      type: "HANDOFF_ALERT",
      enabled,
      config: {
        recipients,
        channel: "WHATSAPP",
        phoneNumbers: phoneNumbers
          .split(/[\n,]+/)
          .map((value) => value.trim())
          .filter(Boolean),
        templateName,
        templateLanguage,
      },
      expectedVersion: rule.version,
    });
    if (!update.success) {
      toast.error(
        update.error.issues[0]?.message ?? "Revisá la configuración del aviso."
      );
      return;
    }
    setSaving(true);
    try {
      const saved = await saveRule(update.data);
      const savedConfig = saved.config as ParsedHandoffRuleConfig;
      setRule(saved);
      setPhoneNumbers(savedConfig.phoneNumbers.join("\n"));
      setTemplateName(savedConfig.templateName);
      setTemplateLanguage(savedConfig.templateLanguage);
      toast.success(enabled ? "Avisos activados" : "Avisos pausados");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la regla.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <BellRing className="size-4 text-primary" />
              Aviso de atención humana
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              Avisa al equipo cuando el asistente deriva una conversación. Una toma manual no genera avisos repetidos.
            </CardDescription>
          </div>
          <RuleState state={rule.state} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor="handoff-enabled">Activar regla</Label>
            <p className="text-xs text-muted-foreground">Podés pausarla sin perder el historial.</p>
          </div>
          <Switch
            id="handoff-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!canManage || saving}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="handoff-recipients">Contexto interno de la derivación</Label>
          <Select
            value={recipients}
            onValueChange={(value) =>
              setRecipients(value as HandoffRuleConfig["recipients"])
            }
            disabled={!canManage || saving}
          >
            <SelectTrigger id="handoff-recipients" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ASSIGNED_AGENT">Agente asignado</SelectItem>
              <SelectItem value="OWNERS_ADMINS">Propietarios y administradores</SelectItem>
              <SelectItem value="BOTH">Ambos</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Define qué miembros se incluyen como contexto seguro del evento. El aviso por WhatsApp se envía únicamente a los números explícitos configurados abajo.
          </p>
        </div>

        <div className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="handoff-channel">Canal del aviso</Label>
            <Select value="WHATSAPP" disabled>
              <SelectTrigger id="handoff-channel" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="handoff-language">Idioma de la plantilla</Label>
            <Input
              id="handoff-language"
              value={templateLanguage}
              onChange={(event) => setTemplateLanguage(event.target.value)}
              placeholder="es_AR"
              maxLength={10}
              autoComplete="off"
              disabled={!canManage || saving}
            />
            <p className="text-xs text-muted-foreground">
              Código aprobado en Meta, por ejemplo es_AR o pt_BR.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="handoff-phone-numbers">
            Números que recibirán el aviso
          </Label>
          <Textarea
            id="handoff-phone-numbers"
            value={phoneNumbers}
            onChange={(event) => setPhoneNumbers(event.target.value)}
            placeholder={canManage ? "Un número E.164 por línea" : undefined}
            rows={4}
            maxLength={240}
            disabled={!canManage || saving}
            autoComplete="off"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Uno por línea, en formato E.164 con signo +. Podés configurar entre 1 y 10 al activar la regla.
            {!canManage && " Los números se muestran enmascarados por seguridad."}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="handoff-template-name">
            Nombre de plantilla aprobada
          </Label>
          <Input
            id="handoff-template-name"
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
            placeholder={canManage ? "aviso_atencion_humana" : undefined}
            maxLength={128}
            autoComplete="off"
            disabled={!canManage || saving}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Debe coincidir con una plantilla estática ya aprobada en Meta. Usá solo minúsculas, números y guiones bajos; no se aceptan mensajes ni variables externas.
          </p>
        </div>

        <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs text-muted-foreground">
          <p className="mb-2 font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            Configuración segura
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            <span>Canal: <strong className="text-foreground">WhatsApp Cloud API</strong></span>
            <span>Idioma: <strong className="text-foreground">{templateLanguage}</strong></span>
            <span className="break-words">Plantilla: <strong className="text-foreground">{templateName || "Sin configurar"}</strong></span>
            <span>Credenciales de Meta: <strong className="text-foreground">protegidas por VantixApp</strong></span>
          </div>
        </div>

        <ExecutionSummary rule={rule} />
        {canManage && (
          <div className="flex justify-end">
            <Button onClick={submit} disabled={saving}>
              {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
              Guardar regla
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FollowUpRuleCard({
  initialRule,
  canManage,
  organizationName,
}: {
  initialRule: AutomationRuleView;
  canManage: boolean;
  organizationName: string;
}) {
  const [rule, setRule] = useState(initialRule);
  const [enabled, setEnabled] = useState(initialRule.enabled);
  const [config, setConfig] = useState<FollowUpRuleConfig>(() =>
    followUpRuleConfigSchema.parse(initialRule.config)
  );
  const [saving, setSaving] = useState(false);

  function patchConfig(values: Partial<FollowUpRuleConfig>) {
    setConfig((current) => ({ ...current, ...values }));
  }

  function toggleDay(day: number) {
    const enabledDays = config.enabledDays.includes(day)
      ? config.enabledDays.filter((value) => value !== day)
      : [...config.enabledDays, day].sort((left, right) => left - right);
    patchConfig({ enabledDays });
  }

  async function submit() {
    const parsed = followUpRuleConfigSchema.safeParse(config);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Revisá la configuración.");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveRule({
        type: "FOLLOW_UP",
        enabled,
        config: parsed.data,
        expectedVersion: rule.version,
      });
      setRule(saved);
      toast.success(enabled ? "Seguimientos activados" : "Seguimientos pausados");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la regla.");
    } finally {
      setSaving(false);
    }
  }

  const preview = followUpRuleConfigSchema.shape.message.safeParse(config.message);
  const previewText = preview.success
    ? renderFollowUpMessage(preview.data, {
        customerName: "María",
        businessName: organizationName,
      })
    : "Corregí el mensaje para ver la vista previa.";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <MessageCircleMore className="size-4 text-primary" />
              Seguimiento automático
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              Envía un mensaje prudente si el cliente no respondió. Cada envío vuelve a validar la conversación, el canal y el horario.
            </CardDescription>
          </div>
          <RuleState state={rule.state} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor="followup-enabled">Activar regla</Label>
            <p className="text-xs text-muted-foreground">Al pausarla se cancelan únicamente seguimientos pendientes.</p>
          </div>
          <Switch
            id="followup-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!canManage || saving}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="followup-delay">Demora</Label>
            <Select
              value={String(config.delayHours)}
              onValueChange={(value) =>
                patchConfig({ delayHours: Number(value) as FollowUpRuleConfig["delayHours"] })
              }
              disabled={!canManage || saving}
            >
              <SelectTrigger id="followup-delay" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[2, 6, 12, 24, 48].map((hours) => (
                  <SelectItem key={hours} value={String(hours)}>{hours} horas</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="followup-maximum">Máximo por conversación</Label>
            <Select
              value={String(config.maxFollowUps)}
              onValueChange={(value) => patchConfig({ maxFollowUps: Number(value) })}
              disabled={!canManage || saving}
            >
              <SelectTrigger id="followup-maximum" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3].map((count) => (
                  <SelectItem key={count} value={String(count)}>{count} seguimiento{count > 1 ? "s" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Clock3 className="size-4" />Horario permitido
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="followup-start">Desde</Label>
              <Input id="followup-start" type="time" value={config.startTime} onChange={(event) => patchConfig({ startTime: event.target.value })} disabled={!canManage || saving} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="followup-end">Hasta</Label>
              <Input id="followup-end" type="time" value={config.endTime} onChange={(event) => patchConfig({ endTime: event.target.value })} disabled={!canManage || saving} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Días habilitados</Label>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {DAY_OPTIONS.map(([day, label]) => (
                <Button
                  key={day}
                  type="button"
                  size="sm"
                  variant={config.enabledDays.includes(day) ? "default" : "outline"}
                  onClick={() => toggleDay(day)}
                  disabled={!canManage || saving}
                  aria-pressed={config.enabledDays.includes(day)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="followup-timezone">Zona horaria IANA de la organización</Label>
            <Input id="followup-timezone" value={config.timeZone} onChange={(event) => patchConfig({ timeZone: event.target.value })} placeholder="America/Argentina/Buenos_Aires" disabled={!canManage || saving} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="followup-message">Mensaje</Label>
          <Textarea id="followup-message" value={config.message} onChange={(event) => patchConfig({ message: event.target.value })} maxLength={500} rows={4} disabled={!canManage || saving} />
          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
            <span>Placeholders permitidos: {"{{customerName}}"} y {"{{businessName}}"}</span>
            <span>{config.message.length} / 500</span>
          </div>
        </div>

        <div className="rounded-lg border border-blue-400/20 bg-blue-400/5 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">Vista previa</p>
          <p className="break-words text-sm leading-relaxed">{previewText}</p>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <div>
            <Label htmlFor="followup-open-only">Solo conversaciones abiertas</Label>
            <p className="text-xs text-muted-foreground">Protección obligatoria para evitar envíos incorrectos.</p>
          </div>
          <Switch id="followup-open-only" checked disabled />
        </div>

        <ExecutionSummary rule={rule} />
        {canManage && (
          <div className="flex justify-end">
            <Button onClick={submit} disabled={saving}>
              {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
              Guardar regla
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AutomationRulesPanel({
  rules,
  canManage,
  organizationName,
}: {
  rules: AutomationRuleView[];
  canManage: boolean;
  organizationName: string;
}) {
  const handoff = rules.find((rule) => rule.type === "HANDOFF_ALERT")!;
  const followUp = rules.find((rule) => rule.type === "FOLLOW_UP")!;
  return (
    <div className="grid min-w-0 gap-4">
      {!canManage && (
        <div className="rounded-lg border border-blue-400/20 bg-blue-400/5 p-3 text-sm text-muted-foreground">
          Tenés acceso de solo lectura. Un propietario o administrador puede modificar estas reglas.
        </div>
      )}
      <HandoffRuleCard initialRule={handoff} canManage={canManage} />
      <FollowUpRuleCard initialRule={followUp} canManage={canManage} organizationName={organizationName} />
    </div>
  );
}
