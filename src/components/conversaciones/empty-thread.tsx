import { Inbox } from "lucide-react";

export function EmptyThread({
  hasConversations,
}: {
  hasConversations: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Inbox className="size-6 text-muted-foreground" aria-hidden />
      </div>
      <div>
        <p className="text-sm font-medium">
          {hasConversations
            ? "Elegí una conversación"
            : "Todavía no hay conversaciones"}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {hasConversations
            ? "Seleccioná una conversación de la lista para leerla y responder."
            : "Probá el agente o conectá WhatsApp: cada consulta va a aparecer acá."}
        </p>
      </div>
    </div>
  );
}
