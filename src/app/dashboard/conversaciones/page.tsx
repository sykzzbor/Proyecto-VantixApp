import type { Metadata } from "next";
import { ConversationList } from "@/components/conversaciones/conversation-list";
import { ConversationThread } from "@/components/conversaciones/conversation-thread";
import { CustomerPanel } from "@/components/conversaciones/customer-panel";
import { EmptyThread } from "@/components/conversaciones/empty-thread";
import { InboxAutoRefresh } from "@/components/conversaciones/inbox-auto-refresh";
import { PageHeader } from "@/components/dashboard/page-header";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { isAgentConfigured } from "@/server/agent/openai";
import { requireOrgContext } from "@/server/context";
import {
  getConversationDetail,
  getInboxConversations,
  markThreadRead,
  type InboxMode,
  type InboxStatus,
} from "@/server/inbox";
import { getTeamMembers } from "@/server/queries";

export const metadata: Metadata = {
  title: "Conversaciones",
};

const STATUS_VALUES: InboxStatus[] = ["open", "pending", "closed"];
const MODE_VALUES: InboxMode[] = ["ai", "human"];

export default async function ConversacionesPage(
  props: PageProps<"/dashboard/conversaciones">
) {
  const { user, org, role } = await requireOrgContext();
  const searchParams = await props.searchParams;

  const q = typeof searchParams.q === "string" ? searchParams.q : undefined;
  const status = STATUS_VALUES.find((value) => value === searchParams.estado);
  const mode = MODE_VALUES.find((value) => value === searchParams.modo);
  const selectedId =
    typeof searchParams.conversacion === "string"
      ? searchParams.conversacion
      : undefined;

  const canRespond = can(role, "inbox.respond");
  const canManage = can(role, "inbox.manage");
  const canEditCustomer = can(role, "customers.update");
  const autoReplyEnabled = isAgentConfigured();

  // El detalle se carga primero: si corresponde, marca los mensajes como
  // leídos para que la lista ya muestre el contador actualizado.
  const detail = selectedId
    ? await getConversationDetail(org.id, selectedId)
    : null;
  if (detail) {
    await markThreadRead(org.id, detail.id);
  }

  const [conversations, members] = await Promise.all([
    getInboxConversations(org.id, { q, status, mode }),
    canManage ? getTeamMembers(org.id) : Promise.resolve([]),
  ]);

  return (
    <div className="flex h-full flex-col space-y-4">
      <PageHeader
        title="Conversaciones"
        description="La bandeja de entrada de tu negocio: mirá lo que responde la IA y tomá el control cuando haga falta."
      >
        <InboxAutoRefresh />
      </PageHeader>

      <div className="flex h-[calc(100svh-13.5rem)] min-h-[480px] overflow-hidden rounded-lg border bg-background">
        {/* Lista de conversaciones */}
        <div
          className={cn(
            "w-full flex-col md:flex md:w-80 md:shrink-0 md:border-r lg:w-88",
            detail ? "hidden md:flex" : "flex"
          )}
        >
          <ConversationList
            items={conversations}
            selectedId={detail?.id ?? null}
            filters={{ q: q ?? "", status: status ?? "", mode: mode ?? "" }}
          />
        </div>

        {/* Hilo de la conversación */}
        <div
          className={cn(
            "min-w-0 flex-1 flex-col",
            detail ? "flex" : "hidden md:flex"
          )}
        >
          {detail ? (
            <ConversationThread
              key={detail.id}
              detail={detail}
              currentUserName={user.name}
              canRespond={canRespond}
              canManage={canManage}
              canEditCustomer={canEditCustomer}
              autoReplyEnabled={autoReplyEnabled}
              members={members.map((member) => ({
                id: member.id,
                userId: member.userId,
                name: member.name,
              }))}
            />
          ) : (
            <EmptyThread hasConversations={conversations.length > 0} />
          )}
        </div>

        {/* Panel del cliente (escritorio ancho) */}
        {detail && (
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l xl:block">
            <CustomerPanel detail={detail} canEdit={canEditCustomer} />
          </aside>
        )}
      </div>
    </div>
  );
}
