import type { Metadata } from "next";
import { Bot, CircleCheckBig, CircleDashed, Power } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { AgentForm } from "@/components/agente/agent-form";
import { TestChat } from "@/components/agente/test-chat";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can } from "@/lib/permissions";
import { isAgentConfigured } from "@/server/agent/config";
import { requireOrgContext } from "@/server/context";
import { getTestChatState } from "@/server/conversations";
import { getAgentSettings } from "@/server/queries";

export const metadata: Metadata = {
  title: "Agente IA",
};

export default async function AgentePage() {
  const { org, role } = await requireOrgContext();
  const [settings, chatState] = await Promise.all([
    getAgentSettings(org.id),
    getTestChatState(org.id),
  ]);

  const assistantName = settings?.assistantName ?? "Asistente";
  const welcomeMessage =
    settings?.welcomeMessage ?? "¡Hola! ¿En qué puedo ayudarte?";
  const configured = isAgentConfigured();
  const enabled = settings?.enabled ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agente IA"
        description="Definí cómo atiende tu asistente, controlá su estado y probalo antes de usarlo con clientes."
      />

      <section
        aria-label="Estado operativo del agente"
        className="grid overflow-hidden rounded-xl border border-border/80 bg-card/55 sm:grid-cols-3"
      >
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3 sm:border-r sm:border-b-0">
          <div className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
            <Bot className="size-4 text-[#8eacff]" aria-hidden />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Asistente</p>
            <p className="text-sm font-semibold">{assistantName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3 sm:border-r sm:border-b-0">
          {configured ? (
            <CircleCheckBig className="size-5 text-emerald-400" aria-hidden />
          ) : (
            <CircleDashed className="size-5 text-amber-300" aria-hidden />
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
            className={enabled ? "size-5 text-emerald-400" : "size-5 text-muted-foreground"}
            aria-hidden
          />
          <div>
            <p className="text-xs text-muted-foreground">Estado</p>
            <p className="text-sm font-semibold">{enabled ? "Activado" : "Desactivado"}</p>
          </div>
        </div>
      </section>

      <Tabs defaultValue="chat" className="space-y-4">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="chat">Chat de prueba</TabsTrigger>
          <TabsTrigger value="configuracion">Configuración</TabsTrigger>
        </TabsList>

        <TabsContent value="chat">
          <TestChat
            enabled={settings?.enabled ?? false}
            configured={configured}
            assistantName={assistantName}
            welcomeMessage={welcomeMessage}
            initialMessages={chatState.messages}
            initialHumanTakeover={chatState.humanTakeover}
          />
        </TabsContent>

        <TabsContent value="configuracion">
          <AgentForm
            canEdit={can(role, "agent.update")}
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
