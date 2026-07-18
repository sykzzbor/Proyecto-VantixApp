import Link from "next/link";
import { ArrowRight, Bot, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsappIcon } from "@/components/whatsapp/whatsapp-icon";

export function EmptyThread({
  hasConversations,
}: {
  hasConversations: boolean;
}) {
  if (hasConversations) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center sm:p-8">
        <div className="flex size-12 items-center justify-center rounded-xl border border-primary/15 bg-primary/10">
          <MousePointerClick className="size-6 text-primary" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-medium">Elegí una conversación</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Seleccioná una conversación de la lista para leerla y responder.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center sm:p-8">
      <div className="flex size-12 items-center justify-center rounded-xl border border-primary/15 bg-primary/10">
        <Bot className="size-6 text-primary" aria-hidden />
      </div>
      <div>
        <p className="text-sm font-medium">Tu bandeja está lista</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Cuando un cliente escriba, la conversación aparece acá con la
          respuesta del agente y el historial completo.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/agente">
            <Bot className="size-4" aria-hidden />
            Probar el agente
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/integraciones">
            <WhatsappIcon className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Conectar WhatsApp
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
