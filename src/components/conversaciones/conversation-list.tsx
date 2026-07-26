"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Bot,
  Check,
  ChevronDown,
  Inbox,
  Search,
  SearchX,
  Tag as TagIcon,
  UserRound,
} from "lucide-react";
import type { ConversationListItem } from "@/server/inbox";
import { InboxAutoRefresh } from "@/components/conversaciones/inbox-auto-refresh";
import { useTableFilters } from "@/components/dashboard/use-table-filters";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  filters: {
    q: string;
    status: string;
    mode: string;
    assignedTo: string;
    tagIds: string[];
    untagged: boolean;
  };
  availableTags: { id: string; name: string; color: string }[];
  members: { userId: string; name: string }[];
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
  availableTags,
  members,
}: ConversationListProps) {
  const { setParam, setSearch, clearAll } = useTableFilters();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectedTags = new Set(filters.tagIds);
  const hasFilters = Boolean(
    filters.q ||
      filters.status ||
      filters.mode ||
      filters.assignedTo ||
      filters.untagged ||
      filters.tagIds.length > 0
  );

  /**
   * Las etiquetas viajan en un solo parámetro separado por coma; el valor
   * especial `sin` filtra las conversaciones sin ninguna.
   */
  function toggleTag(tagId: string) {
    const next = new Set(selectedTags);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    setParam("etiquetas", next.size > 0 ? [...next].join(",") : null);
  }

  function toggleUntagged() {
    setParam("etiquetas", filters.untagged ? null : "sin");
  }

  /** Chips de lo que está filtrando ahora mismo. */
  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.q) {
    activeChips.push({
      key: "q",
      label: `"${filters.q}"`,
      onRemove: () => setParam("q", null),
    });
  }
  if (filters.status) {
    activeChips.push({
      key: "estado",
      label: STATUS_LABEL[filters.status] ?? filters.status,
      onRemove: () => setParam("estado", null),
    });
  }
  if (filters.mode) {
    activeChips.push({
      key: "modo",
      label: filters.mode === "ai" ? "Atendidas por IA" : "Atención humana",
      onRemove: () => setParam("modo", null),
    });
  }
  if (filters.assignedTo) {
    const nombre =
      filters.assignedTo === "unassigned"
        ? "Sin responsable"
        : (members.find((m) => m.userId === filters.assignedTo)?.name ??
          "Responsable");
    activeChips.push({
      key: "responsable",
      label: nombre,
      onRemove: () => setParam("responsable", null),
    });
  }
  if (filters.untagged) {
    activeChips.push({
      key: "sin-etiquetas",
      label: "Sin etiquetas",
      onRemove: () => setParam("etiquetas", null),
    });
  }
  for (const tagId of filters.tagIds) {
    const tag = availableTags.find((t) => t.id === tagId);
    if (!tag) continue;
    activeChips.push({
      key: `tag-${tagId}`,
      label: tag.name,
      onRemove: () => toggleTag(tagId),
    });
  }

  function hrefFor(conversationId: string): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set("conversacion", conversationId);
    return `${pathname}?${params.toString()}`;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-[4.5rem] items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold tracking-[-0.02em] text-foreground">
            Conversaciones
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
            {items.length} {items.length === 1 ? "conversación" : "conversaciones"}
          </p>
        </div>
        <InboxAutoRefresh />
      </div>

      {/* Buscador y filtros */}
      <div className="space-y-2.5 border-b border-border bg-muted/35 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            placeholder="Buscar nombre, teléfono o mensaje…"
            className="pl-9"
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

        <div className="flex gap-2">
          <Select
            value={filters.assignedTo || "todos"}
            onValueChange={(value) =>
              setParam("responsable", value === "todos" ? null : value)
            }
          >
            <SelectTrigger
              size="sm"
              className="flex-1"
              aria-label="Filtrar por responsable"
            >
              <SelectValue placeholder="Responsable" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Cualquier responsable</SelectItem>
              <SelectItem value="unassigned">Sin responsable</SelectItem>
              {members.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 justify-between font-normal"
                aria-label="Filtrar por etiquetas"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <TagIcon className="size-3.5 shrink-0" aria-hidden />
                  {filters.untagged
                    ? "Sin etiquetas"
                    : filters.tagIds.length > 0
                      ? `${filters.tagIds.length} etiqueta${filters.tagIds.length === 1 ? "" : "s"}`
                      : "Etiquetas"}
                </span>
                <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  toggleUntagged();
                }}
              >
                <span className="flex-1">Sin etiquetas</span>
                {filters.untagged && <Check className="size-3.5" aria-hidden />}
              </DropdownMenuItem>

              {availableTags.length > 0 && <DropdownMenuSeparator />}

              {availableTags.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  Todavía no hay etiquetas. Se crean desde Configuración.
                </p>
              ) : (
                availableTags.map((tag) => (
                  <DropdownMenuItem
                    key={tag.id}
                    onSelect={(event) => {
                      event.preventDefault();
                      toggleTag(tag.id);
                    }}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                      aria-hidden
                    />
                    <span className="flex-1 truncate">{tag.name}</span>
                    {selectedTags.has(tag.id) && (
                      <Check className="size-3.5" aria-hidden />
                    )}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {activeChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.onRemove}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-destructive/40 hover:text-foreground"
              >
                <span className="truncate">{chip.label}</span>
                <span aria-hidden>×</span>
                <span className="sr-only">Quitar filtro</span>
              </button>
            ))}
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Limpiar todo
            </button>
          </div>
        )}
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
            {hasFilters && (
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={clearAll}
              >
                Limpiar filtros
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/65">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={hrefFor(item.id)}
                  aria-label={`Abrir conversación con ${item.customerName}`}
                  aria-current={item.id === selectedId ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-[6.5rem] gap-3 px-3.5 py-3.5 transition-[background-color,box-shadow] hover:bg-accent/45 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50",
                    item.unreadCount > 0 && "bg-primary/[0.035]",
                    item.id === selectedId &&
                      "bg-primary/[0.12] shadow-[inset_3px_0_0_var(--primary)]"
                  )}
                >
                  <Avatar className="mt-0.5 size-10 shrink-0">
                    <AvatarFallback className="border border-primary/15 bg-primary/10 text-sm font-semibold text-primary">
                      {initial(item.customerName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={cn(
                          "truncate text-sm leading-5",
                          item.unreadCount > 0 ? "font-semibold" : "font-medium"
                        )}
                      >
                        {item.customerName}
                      </p>
                      {item.lastActivityLabel && (
                        <span className="max-w-24 shrink-0 truncate pt-0.5 text-[10px] text-muted-foreground">
                          {item.lastActivityLabel}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <p
                        className={cn(
                          "flex-1 truncate text-xs leading-5",
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
                    <div className="mt-1.5 flex min-w-0 items-center gap-1.5 overflow-hidden">
                      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                        <span
                          aria-hidden
                          className={cn(
                            "size-1.5 rounded-full",
                            STATUS_DOT[item.status]
                          )}
                        />
                        {STATUS_LABEL[item.status]}
                      </span>
                      <Badge
                        variant="secondary"
                        className="shrink-0 gap-1 px-1.5 py-0 text-[10px] font-normal"
                      >
                        {item.channel === "whatsapp" && (
                          <WhatsappIcon
                            className="size-3 text-emerald-600 dark:text-emerald-400"
                            aria-hidden
                          />
                        )}
                        {channelLabel(item.channel)}
                      </Badge>
                      <span
                        className="flex shrink-0 items-center gap-1 rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
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
                      <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                        {item.assignedName ?? item.customerPhone ?? "Sin asignar"}
                      </span>
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
