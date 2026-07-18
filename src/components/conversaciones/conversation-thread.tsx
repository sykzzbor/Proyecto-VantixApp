"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  MapPin,
  Mic,
  MoreVertical,
  RotateCw,
  SendHorizonal,
  UserRound,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { MAX_HUMAN_MESSAGE_LENGTH } from "@/lib/validations/conversation";
import {
  assignConversation,
  retryWhatsappMessage,
  returnConversationToAI,
  sendHumanMessage,
  setConversationStatus,
  takeConversation,
} from "@/server/actions/conversations";
import type { ConversationDetail, ThreadMessage } from "@/server/inbox";
import { CustomerPanel } from "@/components/conversaciones/customer-panel";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { WhatsappIcon } from "@/components/whatsapp/whatsapp-icon";
import { cn } from "@/lib/utils";

type ThreadMember = { id: string; userId: string; name: string };

type ConversationThreadProps = {
  detail: ConversationDetail;
  currentUserName: string;
  canRespond: boolean;
  canManage: boolean;
  canEditCustomer: boolean;
  autoReplyEnabled: boolean;
  members: ThreadMember[];
};

type MessageActionResult = {
  ok: boolean;
  error?: string;
  message?: ThreadMessage;
};

const STATUS_LABEL: Record<string, string> = {
  open: "Abierta",
  pending: "Pendiente",
  closed: "Cerrada",
};

const STATUS_DOT: Record<string, string> = {
  open: "bg-emerald-500",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground/40",
};

const DELIVERY_LABEL = {
  pending: "Pendiente",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Falló",
} as const;

function DeliveryStatus({ message }: { message: ThreadMessage }) {
  if (!message.deliveryStatus) return null;

  const icon =
    message.deliveryStatus === "pending" ? (
      <Clock3 className="size-3" aria-hidden />
    ) : message.deliveryStatus === "sent" ? (
      <Check className="size-3" aria-hidden />
    ) : message.deliveryStatus === "failed" ? (
      <CircleAlert className="size-3" aria-hidden />
    ) : (
      <CheckCheck className="size-3" aria-hidden />
    );

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        message.deliveryStatus === "read" && "text-[#3b82f6]",
        message.deliveryStatus === "failed" && "text-destructive"
      )}
    >
      {icon}
      {DELIVERY_LABEL[message.deliveryStatus]}
    </span>
  );
}

function groupByDay(messages: ThreadMessage[]) {
  const groups: { dateLabel: string; messages: ThreadMessage[] }[] = [];
  for (const message of messages) {
    const last = groups[groups.length - 1];
    if (last && last.dateLabel === message.dateLabel) {
      last.messages.push(message);
    } else {
      groups.push({ dateLabel: message.dateLabel, messages: [message] });
    }
  }
  return groups;
}

function MessageContent({ message }: { message: ThreadMessage }) {
  if (message.messageType === "text") return message.content;
  const media = {
    audio: { icon: Mic, label: "Mensaje de audio" },
    image: { icon: ImageIcon, label: "Imagen" },
    document: { icon: FileText, label: "Documento" },
    video: { icon: Video, label: "Video" },
    sticker: { icon: ImageIcon, label: "Sticker" },
    location: { icon: MapPin, label: "Ubicación" },
    unknown: { icon: FileText, label: "Contenido multimedia" },
  }[message.messageType];
  const Icon = media.icon;
  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-2 font-medium">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-black/[0.08]">
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block">{media.label}</span>
          {message.mediaFilename && (
            <span className="block max-w-60 truncate text-[11px] font-normal opacity-70">
              {message.mediaFilename}
            </span>
          )}
        </span>
      </span>
      {message.content && (
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {message.content}
        </p>
      )}
    </div>
  );
}

export function ConversationThread({
  detail,
  currentUserName,
  canRespond,
  canManage,
  canEditCustomer,
  autoReplyEnabled,
  members,
}: ConversationThreadProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<ThreadMessage[]>(detail.messages);
  const [serverMessages, setServerMessages] = useState(detail.messages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // El servidor revalida tras cada acción: si llegan mensajes nuevos desde
  // el servidor, el hilo local se ajusta durante el render (sin efectos).
  if (detail.messages !== serverMessages) {
    setServerMessages(detail.messages);
    setMessages(detail.messages);
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const initialScrollDoneRef = useRef(false);

  const customerName = detail.customer?.name ?? "Cliente de prueba";
  const isClosed = detail.status === "closed";
  const isHuman = detail.handlingMode === "human";
  const isWhatsapp = detail.channel === "whatsapp";
  const canWrite = canRespond && isHuman && !isClosed;
  const messageCountLabel = `${messages.length}${messages.length === 200 ? "+" : ""} ${
    messages.length === 1 ? "mensaje" : "mensajes"
  }`;

  useEffect(() => {
    initialScrollDoneRef.current = false;
    shouldStickToBottomRef.current = true;
  }, [detail.id]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (!initialScrollDoneRef.current || shouldStickToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
      initialScrollDoneRef.current = true;
    }
  }, [messages.length]);

  function backHref(): string {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("conversacion");
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  function autoresize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  function runAction(action: () => Promise<{ ok: boolean }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
      } else {
        toast.error((result as { error?: string }).error ?? "No se pudo completar la acción.");
      }
    });
  }

  function appendMessage(message?: ThreadMessage) {
    if (!message) return;
    shouldStickToBottomRef.current = true;
    setMessages((previous) =>
      previous.some((item) => item.id === message.id)
        ? previous
        : [...previous, message]
    );
  }

  async function send() {
    const text = input.trim();
    if (!text || !canWrite || sending) return;

    setSending(true);
    try {
      const result = (await sendHumanMessage(detail.id, {
        content: text,
      })) as MessageActionResult;
      appendMessage(result.message);

      if (!result.ok) {
        // El intento fallido puede mostrarse en el hilo, pero el borrador se conserva.
        toast.error(result.error ?? "No se pudo enviar el mensaje.");
        return;
      }

      setInput("");
      requestAnimationFrame(autoresize);
      textareaRef.current?.focus();
    } catch {
      toast.error("No se pudo conectar con el servidor. El texto quedó guardado.");
    } finally {
      setSending(false);
    }
  }

  async function retryMessage(messageId: string) {
    if (!canRespond || !isHuman || isClosed || retryingMessageId) return;

    setRetryingMessageId(messageId);
    try {
      const result = (await retryWhatsappMessage(messageId)) as MessageActionResult;
      // Cada reintento es un nuevo intento: la burbuja fallida original se conserva.
      appendMessage(result.message);
      if (result.ok) {
        toast.success("Mensaje reenviado por WhatsApp.");
      } else {
        toast.error(result.error ?? "No se pudo reenviar el mensaje.");
      }
    } catch {
      toast.error("No se pudo conectar con el servidor para reintentar.");
    } finally {
      setRetryingMessageId(null);
    }
  }

  const groups = groupByDay(messages);
  const customerPanelProps = {
    detail,
    canEdit: canEditCustomer,
    canRespond,
    canManage,
    members,
    isPending,
    onTake: () =>
      runAction(
        () => takeConversation(detail.id),
        "Tomaste la conversación."
      ),
    onReturnToAI: () =>
      runAction(
        () => returnConversationToAI(detail.id),
        "La conversación volvió a la IA."
      ),
    onStatusChange: (status: "OPEN" | "PENDING" | "CLOSED") =>
      runAction(
        () => setConversationStatus(detail.id, status),
        "Estado de la conversación actualizado."
      ),
    onAssign: (membershipId: string | null) =>
      runAction(
        () => assignConversation(detail.id, membershipId),
        "Responsable actualizado."
      ),
  };

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden bg-card">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Encabezado del hilo */}
      <div className="flex min-h-[4.5rem] items-center gap-2 border-b border-border bg-card/95 px-3 py-2.5 md:px-4">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Volver a la lista"
        >
          <Link href={backHref()}>
            <ArrowLeft className="size-4" />
          </Link>
        </Button>

        <Avatar className="hidden size-10 sm:flex">
          <AvatarFallback className="border border-primary/15 bg-primary/10 text-xs font-semibold text-primary">
            {customerName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold tracking-[-0.01em]">{customerName}</p>
            <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">
              {messageCountLabel}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className="gap-1 px-1.5 py-0 text-[10px] font-normal"
            >
              <span
                aria-hidden
                className={cn("size-1.5 rounded-full", STATUS_DOT[detail.status])}
              />
              {STATUS_LABEL[detail.status]}
            </Badge>
            <span
              className="flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-muted-foreground"
              aria-label={
                detail.channel === "test"
                  ? "Canal de prueba"
                  : isWhatsapp
                    ? "Canal WhatsApp"
                    : `Canal ${detail.channel}`
              }
            >
              {isWhatsapp && (
                <WhatsappIcon
                  className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                />
              )}
              <span className="hidden shrink-0 sm:inline">
                {detail.channel === "test"
                  ? "Canal de prueba"
                  : isWhatsapp
                    ? "WhatsApp"
                    : detail.channel}
              </span>
              {isWhatsapp && detail.customer?.phone && (
                <span className="hidden truncate sm:inline" title={detail.customer.phone}>
                  · {detail.customer.phone}
                </span>
              )}
            </span>
            <span
              className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
              title={isHuman ? "Atención humana" : "IA respondiendo"}
            >
              {isHuman ? (
                <UserRound className="size-3" aria-hidden />
              ) : (
                <Bot className="size-3" aria-hidden />
              )}
              <span className="hidden md:inline">
                {isHuman ? "Humano" : "IA respondiendo"}
              </span>
            </span>
            {detail.assigned && (
              <span className="hidden truncate text-[10px] text-muted-foreground xl:inline">
                · {detail.assigned.name}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {canRespond && !isClosed && (
            isHuman ? (
              <Button
                variant="outline"
                size="sm"
                aria-label="Devolver conversación a la IA"
                title="Devolver conversación a la IA"
                disabled={isPending}
                onClick={() =>
                  runAction(
                    () => returnConversationToAI(detail.id),
                    "La conversación volvió a la IA."
                  )
                }
              >
                <Bot className="size-4" />
                  <span className="hidden xl:inline">Devolver a la IA</span>
              </Button>
            ) : (
              <Button
                size="sm"
                aria-label="Tomar conversación"
                title="Tomar conversación"
                disabled={isPending}
                onClick={() =>
                  runAction(
                    () => takeConversation(detail.id),
                    "Tomaste la conversación."
                  )
                }
              >
                <UserRound className="size-4" />
                  <span className="hidden xl:inline">Tomar conversación</span>
              </Button>
            )
          )}

          {/* Información del cliente en pantallas angostas */}
          <div className="xl:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Ver información del cliente"
                  aria-label="Ver información del cliente"
                >
                  <Info className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full max-w-sm overflow-y-auto p-0">
                <SheetHeader className="border-b px-4 py-3 text-left">
                  <SheetTitle className="text-base">Cliente</SheetTitle>
                </SheetHeader>
                <CustomerPanel {...customerPanelProps} instanceId="drawer" />
              </SheetContent>
            </Sheet>
          </div>

          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Más acciones"
                  aria-label="Más acciones"
                  disabled={isPending}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Estado</DropdownMenuLabel>
                {(["OPEN", "PENDING", "CLOSED"] as const).map((status) => {
                  const value = status.toLowerCase();
                  const labels: Record<string, string> = {
                    open: "Abierta",
                    pending: "Pendiente",
                    closed: "Cerrada",
                  };
                  return (
                    <DropdownMenuItem
                      key={status}
                      onSelect={() =>
                        runAction(
                          () => setConversationStatus(detail.id, status),
                          `Estado cambiado a ${labels[value].toLowerCase()}.`
                        )
                      }
                    >
                      {detail.status === value && <Check className="size-4" />}
                      <span className={detail.status === value ? "" : "pl-6"}>
                        {labels[value]}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Responsable</DropdownMenuLabel>
                {members.map((member) => (
                  <DropdownMenuItem
                    key={member.id}
                    onSelect={() =>
                      runAction(
                        () => assignConversation(detail.id, member.id),
                        `Conversación asignada a ${member.name}.`
                      )
                    }
                  >
                    {detail.assigned?.userId === member.userId && (
                      <Check className="size-4" />
                    )}
                    <span
                      className={
                        detail.assigned?.userId === member.userId ? "" : "pl-6"
                      }
                    >
                      {member.name}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onSelect={() =>
                    runAction(
                      () => assignConversation(detail.id, null),
                      "La conversación quedó sin responsable."
                    )
                  }
                >
                  <span className={detail.assigned ? "pl-6" : ""}>
                    {!detail.assigned && <Check className="mr-2 inline size-4" />}
                    Sin responsable
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Estado del canal y de las respuestas automáticas */}
      {isWhatsapp && detail.whatsappIntegrationStatus !== "connected" && (
        <div className="flex items-start gap-2 border-b border-destructive/15 bg-destructive/[0.06] px-4 py-2.5 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <p>
            {detail.whatsappIntegrationStatus === "error"
              ? "WhatsApp tiene un error de conexión. Revisá la integración antes de responder."
              : "WhatsApp está desconectado. Los mensajes no se pueden enviar hasta reconectar la integración."}
          </p>
        </div>
      )}

      {isWhatsapp &&
        detail.whatsappIntegrationStatus === "connected" &&
        !autoReplyEnabled && (
          <div className="flex items-start gap-2 border-b border-amber-500/15 bg-amber-500/[0.07] px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200">
            <Bot className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p>
              Las respuestas automáticas están desactivadas. Los mensajes nuevos
              quedan pendientes para atención humana.
            </p>
          </div>
        )}

      {/* Indicador de atención humana */}
      {isHuman && (
        <div className="flex items-start gap-2 border-b border-amber-500/15 bg-amber-500/[0.07] px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          <UserRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <p>
            Atención humana
            {detail.assigned ? (
              <>
                {" "}
                a cargo de <strong>{detail.assigned.name}</strong>
              </>
            ) : (
              " sin responsable asignado"
            )}
            {detail.humanTakeoverAtLabel && (
              <> · desde el {detail.humanTakeoverAtLabel}</>
            )}
            . La IA no responde en esta conversación.
          </p>
        </div>
      )}

      {/* Mensajes */}
      <div
        ref={scrollRef}
        className="inbox-conversation-canvas min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
        onScroll={(event) => {
          const target = event.currentTarget;
          const distanceFromBottom =
            target.scrollHeight - target.scrollTop - target.clientHeight;
          shouldStickToBottomRef.current = distanceFromBottom < 96;
        }}
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Esta conversación todavía no tiene mensajes.
            </p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl space-y-5">
            {groups.map((group) => (
              <div key={group.dateLabel} className="space-y-3">
                <div className="flex items-center justify-center py-1">
                  <span className="rounded-lg bg-white/85 px-2.5 py-1 text-[10px] font-medium text-[#54656f] shadow-sm">
                    {group.dateLabel}
                  </span>
                </div>
                {group.messages.map((message) => {
                  if (message.senderType === "system") {
                    return (
                      <p
                        key={message.id}
                        className="mx-auto w-fit max-w-[90%] rounded-lg bg-[#fdf3d0] px-3 py-1.5 text-center text-[11px] leading-relaxed text-[#5c5240] shadow-sm"
                      >
                        {message.content} · {message.timeLabel}
                      </p>
                    );
                  }
                  const fromCustomer = message.senderType === "customer";
                  const failed = message.deliveryStatus === "failed";
                  const canRetry =
                    message.retryable && canRespond && isHuman && !isClosed;
                  return (
                    <div
                      key={message.id}
                      className={cn(
                        "flex flex-col",
                        fromCustomer ? "items-start" : "items-end"
                      )}
                    >
                      <span className="mb-1 flex items-center gap-1 px-1 text-[10px] font-medium text-[#6b6255]">
                        {message.senderType === "ai" && (
                          <Bot className="size-3 text-emerald-700" aria-hidden />
                        )}
                        {message.senderName}
                        {message.senderType === "ai" && " · IA"}
                        {" · "}
                        {message.timeLabel}
                      </span>
                      <div
                        className={cn(
                          "max-w-[90%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm sm:max-w-[76%]",
                          // Entrantes: burbuja blanca sobre el lienzo claro.
                          fromCustomer && "rounded-bl-md bg-white text-[#111b21]",
                          !fromCustomer &&
                            failed &&
                            "rounded-br-md border border-destructive/50 bg-[#fdecea] text-[#7f1d1d]",
                          // IA: verde suave, con el indicador Bot en la etiqueta.
                          !failed &&
                            message.senderType === "ai" &&
                            "rounded-br-md bg-[#d9fdd3] text-[#0b3d1f]",
                          // Humanos: azul Vantix.
                          !failed &&
                            message.senderType === "human" &&
                            "rounded-br-md bg-primary text-primary-foreground shadow-[0_10px_28px_-18px_rgba(79,124,255,0.95)]"
                        )}
                      >
                        <MessageContent message={message} />
                      </div>
                      {message.deliveryStatus && (
                        <div className="mt-1 flex max-w-[85%] items-center justify-end gap-1.5 px-1 text-[10px] text-[#6b6255] sm:max-w-[70%]">
                          <DeliveryStatus message={message} />
                          {canRetry && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              className="h-5 px-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={retryingMessageId !== null}
                              onClick={() => retryMessage(message.id)}
                            >
                              <RotateCw
                                className={cn(
                                  "size-3",
                                  retryingMessageId === message.id && "animate-spin"
                                )}
                                aria-hidden
                              />
                              Reintentar
                            </Button>
                          )}
                        </div>
                      )}
                      {failed && (
                        <p
                          className="mt-0.5 max-w-[85%] px-1 text-right text-[10px] leading-snug text-destructive sm:max-w-[70%]"
                          title={
                            message.errorCode
                              ? `Código ${message.errorCode}`
                              : undefined
                          }
                        >
                          {message.errorMessage ??
                            "WhatsApp no pudo entregar este mensaje."}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Zona de escritura */}
      {isClosed ? (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/55 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleAlert className="size-4" aria-hidden />
            La conversación está cerrada.
          </p>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                runAction(
                  () => setConversationStatus(detail.id, "OPEN"),
                  "Conversación reabierta."
                )
              }
            >
              Reabrir
            </Button>
          )}
        </div>
      ) : !canRespond ? (
        <div className="border-t border-border bg-muted/55 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="text-sm text-muted-foreground">
            Tu rol es de solo lectura: no podés responder conversaciones.
          </p>
        </div>
      ) : !isHuman ? (
        <div className="flex flex-col items-start justify-between gap-3 border-t border-border bg-primary/[0.045] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bot className="size-4" aria-hidden />
            IA respondiendo. Para escribir vos, tomá la conversación.
          </p>
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              runAction(
                () => takeConversation(detail.id),
                "Tomaste la conversación."
              )
            }
          >
            <UserRound className="size-4" />
            Tomar conversación
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2 border-t border-border bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <div className="flex items-center gap-2 px-1 text-[10px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            <span>Atención humana</span>
            <span className="ml-auto hidden sm:inline">
              Enter para enviar · Shift + Enter para nueva línea
            </span>
          </div>
          <div className="flex items-end gap-2 rounded-xl border border-input bg-muted/25 p-1.5 focus-within:border-primary/60 focus-within:ring-3 focus-within:ring-primary/15">
            <Textarea
              ref={textareaRef}
              value={input}
              disabled={sending}
              maxLength={MAX_HUMAN_MESSAGE_LENGTH}
              rows={1}
              placeholder={`Responder como ${currentUserName}…`}
              className="max-h-[140px] min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:bg-transparent focus-visible:ring-0"
              onChange={(event) => {
                setInput(event.target.value);
                autoresize();
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  send();
                }
              }}
              aria-label="Respuesta para el cliente"
            />
            <Button
              type="submit"
              size="icon"
              className="size-9"
              disabled={sending || input.trim().length === 0}
              aria-label="Enviar respuesta"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <SendHorizonal className="size-4" />
              )}
            </Button>
          </div>
        </form>
      )}
      </div>

      <aside className="hidden w-60 shrink-0 overflow-y-auto border-l border-border bg-muted/25 xl:block 2xl:w-[17rem]">
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 px-4 py-4 backdrop-blur">
          <p className="text-sm font-semibold">Cliente</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Contexto y datos de contacto
          </p>
        </div>
        <CustomerPanel {...customerPanelProps} instanceId="sidebar" />
      </aside>
    </div>
  );
}
