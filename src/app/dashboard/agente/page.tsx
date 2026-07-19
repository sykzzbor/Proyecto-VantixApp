import type { Metadata } from "next";
import Link from "next/link";
import { Bot, CircleCheckBig, CircleDashed, MessageSquareText, Power, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { AgentForm } from "@/components/agente/agent-form";
import { TestChat } from "@/components/agente/test-chat";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { isAgentConfigured } from "@/server/agent/config";
import { requireOrgContext } from "@/server/context";
import { getTestChatState } from "@/server/conversations";
import { getAgentSettings } from "@/server/queries";

export const metadata: Metadata = {
  title: "Agente IA",
};

export default async function AgentePage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string }>;
}) {
  const { org, role } = await requireOrgContext();
  const params = await searchParams;
  const [settings, chatState] = await Promise.all([
    getAgentSettings(org.id),
    getTestChatState(org.id),
  ]);

  const assistantName = settings?.assistantName ?? "Asistente";
  const welcomeMessage =
    settings?.welcomeMessage ?? "¡Hola! ¿En qué puedo ayudarte?";
  const configured = isAgentConfigured();
  const enabled = settings?.enabled ?? false;
  const canEditAgent = can(role, "agent.update");
  const activeView = params.vista === "configuracion" ? "configuracion" : "chat";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 sm:gap-5">
      <PageHeader
        title="Agente IA"
        description="Un único lugar para definir la identidad, el comportamiento y la puesta en marcha del asistente principal."
      >
        <Button asChild size="sm">
          <Link href="/dashboard/agente?vista=configuracion">
            <Settings2 className="size-4" aria-hidden />
            {canEditAgent ? "Configurar agente" : "Ver configuración"}
          </Link>
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">Agente principal</Badge>
        <span>Una configuración compartida por toda la organización</span>
      </div>

      <section
        aria-label="Estado operativo del agente"
        className="grid overflow-hidden rounded-xl border border-border/80 bg-card/55 sm:grid-cols-3"
      >
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3 sm:border-r sm:border-b-0">
          <div className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
            <Bot className="size-4 text-primary" aria-hidden />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Asistente</p>
            <p className="text-sm font-semibold">{assistantName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3 sm:border-r sm:border-b-0">
          {configured ? (
            <CircleCheckBig className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
          ) : (
            <CircleDashed className="size-5 text-amber-700 dark:text-amber-300" aria-hidden />
          )}
          <div>
            <p className="text-xs text-muted-foreground">Configuración</p>
            <p className="text-sm font-semibold">
              {configured ? "Lista para responder" : "Requiere completar"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <Power
            className={enabled ? "size-5 text-emerald-600 dark:text-emerald-400" : "size-5 text-muted-foreground"}
            aria-hidden
          />
          <div>
            <p className="text-xs text-muted-foreground">Estado</p>
            <p className="text-sm font-semibold">{enabled ? "Activado" : "Desactivado"}</p>
          </div>
        </div>
      </section>

      <Tabs
        key={activeView}
        defaultValue={activeView}
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="chat">
            <MessageSquareText className="size-3.5" aria-hidden />
            Chat de prueba
          </TabsTrigger>
          <TabsTrigger value="configuracion">
            <Settings2 className="size-3.5" aria-hidden />
            Configuración
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-0 min-h-0 flex-1">
          <TestChat
            enabled={settings?.enabled ?? false}
            configured={configured}
            assistantName={assistantName}
            welcomeMessage={welcomeMessage}
            initialMessages={chatState.messages}
            initialHumanTakeover={chatState.humanTakeover}
          />
        </TabsContent>

        <TabsContent value="configuracion" className="mt-0">
          <AgentForm
            canEdit={canEditAgent}
            configured={configured}
            defaults={{
              assistantName,
              tone: settings?.tone ?? "PROFESSIONAL",
              welcomeMessage,
              fallbackMessage:
                settings?.fallbackMessage ??
                "No tengo esa información. Un miembro del equipo te va a responder a la brevedad.",
              handoffRules: settings?.handoffRules ?? "",
              enabled: settings?.enabled ?? false,
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
