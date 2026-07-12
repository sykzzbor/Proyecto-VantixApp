import type { Metadata } from "next";
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agente IA"
        description="Configurá la personalidad de tu asistente y probalo en una conversación real antes de conectarlo a tus canales."
      />

      <Tabs defaultValue="chat" className="space-y-4">
        <TabsList>
          <TabsTrigger value="chat">Chat de prueba</TabsTrigger>
          <TabsTrigger value="configuracion">Configuración</TabsTrigger>
        </TabsList>

        <TabsContent value="chat">
          <TestChat
            enabled={settings?.enabled ?? false}
            configured={isAgentConfigured()}
            assistantName={assistantName}
            welcomeMessage={welcomeMessage}
            initialMessages={chatState.messages}
            initialHumanTakeover={chatState.humanTakeover}
          />
        </TabsContent>

        <TabsContent value="configuracion">
          <AgentForm
            canEdit={can(role, "agent.update")}
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
