"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bot, Inbox, Search, SearchX, UserRound } from "lucide-react";
import type { ConversationListItem } from "@/server/inbox";
import { InboxAutoRefresh } from "@/components/conversaciones/inbox-auto-refresh";
import { useTableFilters } from "@/components/dashboard/use-table-filters";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { WhatsappIcon } from "@/components/whatsapp/whatsapp-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ConversationListProps = {
  items: ConversationListItem[];
  selectedId: string | null;
  filters: { q: string; status: string; mode: string };
};

const STATUS_DOT: Record<string, string> = {
  open: "bg-emerald-500",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground/40",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Abierta",
  pending: "Pendiente",
  closed: "Cerrada",
};

function channelLabel(channel: string): string {
  if (channel === "test") return "Prueba";
  if (channel === "whatsapp") return "WhatsApp";
  return channel;
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "C";
}

export function ConversationList({
  items,
  selectedId,
  filters,
}: ConversationListProps) {
  const { setParam, setSearch } = useTableFilters();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hasFilters = Boolean(filters.q || filters.status || filters.mode);

  function hrefFor(conversationId: string): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set("conversacion", conversationId);
    return `${pathname}?${params.toString()}`;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-16 items-center justify-between gap-3 border-b border-border bg-sidebar/65 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">
            Conversaciones
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {items.length} {items.length === 1 ? "conversación" : "conversaciones"}
          </p>
        </div>
        <InboxAutoRefresh />
      </div>

      {/* Buscador y filtros */}
      <div className="space-y-2.5 border-b border-border bg-sidebar/35 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar nombre, teléfono o mensaje…"
            className="pl-8"
            defaultValue={filters.q}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Buscar conversaciones"
          />
        </div>
        <div className="flex gap-2">
          <Select
            value={filters.status || "todas"}
            onValueChange={(value) =>
              setParam("estado", value === "todas" ? null : value)
            }
          >
            <SelectTrigger
              size="sm"
              className="flex-1"
              aria-label="Filtrar por estado"
            >
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="open">Abiertas</SelectItem>
              <SelectItem value="pending">Pendientes</SelectItem>
              <SelectItem value="closed">Cerradas</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.mode || "todos"}
            onValueChange={(value) =>
              setParam("modo", value === "todos" ? null : value)
            }
          >
            <SelectTrigger
              size="sm"
              className="flex-1"
              aria-label="Filtrar por modo de atención"
            >
              <SelectValue placeholder="Modo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">IA y humanos</SelectItem>
              <SelectItem value="ai">Atendidas por IA</SelectItem>
              <SelectItem value="human">Atención humana</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Lista */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
              {hasFilters ? (
                <SearchX className="size-5 text-muted-foreground" aria-hidden />
              ) : (
                <Inbox className="size-5 text-muted-foreground" aria-hidden />
              )}
            </div>
            <p className="text-sm font-medium">
              {hasFilters ? "Sin resultados" : "Todavía no hay conversaciones"}
            </p>
            <p className="text-xs text-muted-foreground">
              {hasFilters
                ? "Probá con otra búsqueda u otros filtros."
                : "Los mensajes del chat de prueba y WhatsApp van a aparecer acá."}
            </p>
          </div>
        ) : (
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={hrefFor(item.id)}
                  aria-label={`Abrir conversación con ${item.customerName}`}
                  aria-current={item.id === selectedId ? "true" : undefined}
                  className={cn(
                    "relative flex gap-3 border-b border-border/65 px-3.5 py-3 transition-colors hover:bg-accent/50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50",
                    item.id === selectedId &&
                      "bg-primary/[0.11] shadow-[inset_3px_0_0_var(--primary)]"
                  )}
                >
                  <Avatar className="mt-0.5 size-9 shrink-0">
                    <AvatarFallback className="border border-primary/15 bg-primary/10 text-sm font-semibold text-[#9cb7ff]">
                      {initial(item.customerName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p
                        className={cn(
                          "truncate text-sm",
                          item.unreadCount > 0 ? "font-semibold" : "font-medium"
                        )}
                      >
                        {item.customerName}
                      </p>
                      {item.lastActivityLabel && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {item.lastActivityLabel}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <p
                        className={cn(
                          "flex-1 truncate text-xs",
                          item.unreadCount > 0
                            ? "font-medium text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        {item.lastMessagePreview ?? "Sin mensajes"}
                      </p>
                      {item.unreadCount > 0 && (
                        <span
                          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground shadow-sm shadow-primary/30"
                          aria-label={`${item.unreadCount} mensajes sin leer`}
                        >
                          {item.unreadCount > 9 ? "9+" : item.unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] font-normal">
                        <span
                          aria-hidden
                          className={cn(
                            "size-1.5 rounded-full",
                            STATUS_DOT[item.status]
                          )}
                        />
                        {STATUS_LABEL[item.status]}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className="gap-1 px-1.5 py-0 text-[10px] font-normal"
                      >
                        {item.channel === "whatsapp" && (
                          <WhatsappIcon
                            className="size-3 text-emerald-600 dark:text-emerald-400"
                            aria-hidden
                          />
                        )}
                        {channelLabel(item.channel)}
                      </Badge>
                      {item.channel === "whatsapp" && item.customerPhone && (
                        <span
                          className="max-w-28 truncate text-[10px] text-muted-foreground"
                          title={item.customerPhone}
                        >
                          {item.customerPhone}
                        </span>
                      )}
                      <span
                        className="flex items-center gap-1 text-[10px] text-muted-foreground"
                        title={
                          item.handlingMode === "ai"
                            ? "Atendida por la IA"
                            : "Atención humana"
                        }
                      >
                        {item.handlingMode === "ai" ? (
                          <Bot className="size-3" aria-hidden />
                        ) : (
                          <UserRound className="size-3" aria-hidden />
                        )}
                        {item.handlingMode === "ai" ? "IA" : "Humano"}
                      </span>
                      {item.assignedName && (
                        <span className="truncate text-[10px] text-muted-foreground">
                          · {item.assignedName}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
