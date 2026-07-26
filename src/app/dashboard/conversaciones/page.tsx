import type { Metadata } from "next";
import { ConversationList } from "@/components/conversaciones/conversation-list";
import { ConversationThread } from "@/components/conversaciones/conversation-thread";
import { EmptyThread } from "@/components/conversaciones/empty-thread";
import { NotesAndTags } from "@/components/conversaciones/notes-and-tags";
import {
  getConversationNotes,
  getConversationTags,
  getOrganizationTags,
} from "@/server/crm";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { isAgentConfigured } from "@/server/agent/config";
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
  const assignedTo =
    typeof searchParams.responsable === "string"
      ? searchParams.responsable
      : undefined;
  // Varias etiquetas viajan separadas por coma. Se recortan a 12 para que
  // una URL manipulada no arme un IN gigante.
  const tagIds =
    typeof searchParams.etiquetas === "string"
      ? searchParams.etiquetas
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];
  const untagged = searchParams.etiquetas === "sin";
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

  const [conversations, members, availableTags, appliedTags, notes] =
    await Promise.all([
      getInboxConversations(org.id, {
        q,
        status,
        mode,
        assignedTo,
        tagIds: untagged ? [] : tagIds,
        untagged,
      }),
      canManage ? getTeamMembers(org.id) : Promise.resolve([]),
      getOrganizationTags(org.id),
      detail ? getConversationTags(org.id, detail.id) : Promise.resolve([]),
      detail ? getConversationNotes(org.id, detail.id) : Promise.resolve([]),
    ]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-full min-h-0 overflow-hidden bg-card">
        <div
          className={cn(
            "w-full flex-col bg-card md:flex md:w-[18.75rem] md:shrink-0 md:border-r md:border-border",
            detail ? "hidden md:flex" : "flex"
          )}
        >
          <ConversationList
            items={conversations}
            selectedId={detail?.id ?? null}
            filters={{
              q: q ?? "",
              status: status ?? "",
              mode: mode ?? "",
              assignedTo: assignedTo ?? "",
              tagIds: untagged ? [] : tagIds,
              untagged,
            }}
            availableTags={availableTags}
            members={members.map((member) => ({
              userId: member.userId,
              name: member.name,
            }))}
          />
        </div>

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
              crmSlot={
                <NotesAndTags
                  conversationId={detail.id}
                  notes={notes}
                  appliedTags={appliedTags}
                  availableTags={availableTags}
                  currentUserId={user.id}
                  canWrite={canRespond}
                  canModerate={canManage}
                />
              }
            />
          ) : (
            <EmptyThread hasConversations={conversations.length > 0} />
          )}
        </div>
      </div>
    </div>
  );
}
