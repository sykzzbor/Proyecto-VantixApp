"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, CircleAlert, Info, RotateCcw, SendHorizonal, UserRound } from "lucide-react";
import { toast } from "sonner";
import { MAX_CHAT_MESSAGE_LENGTH } from "@/lib/validations/chat";
import { clearTestConversation } from "@/server/actions/agent";
import type { ChatMessageDTO } from "@/server/conversations";
import { ConfirmDeleteDialog } from "@/components/dashboard/confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TestChatProps = {
  enabled: boolean;
  configured: boolean;
  assistantName: string;
  welcomeMessage: string;
  initialMessages: ChatMessageDTO[];
  initialHumanTakeover: boolean;
};

function nowLabel(): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1 py-1.5" aria-label="El agente está escribiendo">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

export function TestChat({
  enabled,
  configured,
  assistantName,
  welcomeMessage,
  initialMessages,
  initialHumanTakeover,
}: TestChatProps) {
  const [messages, setMessages] = useState<ChatMessageDTO[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [humanTakeover, setHumanTakeover] = useState(initialHumanTakeover);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = enabled && !sending;

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages.length, sending]);

  function autoresize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  async function send() {
    const text = input.trim();
    if (!text || !canSend) return;

    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: text,
        timeLabel: nowLabel(),
      },
    ]);
    setInput("");
    setError(null);
    setSending(true);
    requestAnimationFrame(autoresize);

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data: {
        reply?: string | null;
        humanMode?: boolean;
        humanTakeover?: boolean;
        messageId?: string;
        timeLabel?: string;
        message?: string;
      } | null = await response.json().catch(() => null);

      // La conversación está en manos del equipo: el mensaje quedó guardado
      // y la IA no responde. El banner de atención humana lo explica.
      if (response.ok && data?.humanMode) {
        setHumanTakeover(true);
        return;
      }

      const reply = data?.reply;
      if (!response.ok || !reply) {
        setError(data?.message ?? "No se pudo enviar el mensaje. Probá de nuevo.");
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: data?.messageId ?? `assistant-${Date.now()}`,
          role: "assistant",
          content: reply,
          timeLabel: data?.timeLabel ?? nowLabel(),
        },
      ]);
      if (data.humanTakeover) setHumanTakeover(true);
    } catch {
      setError("No se pudo conectar con el servidor. Revisá tu conexión.");
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  async function handleClear() {
    setClearing(true);
    const result = await clearTestConversation();
    setClearing(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setMessages([]);
    setHumanTakeover(false);
    setError(null);
    setConfirmClear(false);
    toast.success("Conversación reiniciada.");
  }

  return (
    <Card className="flex h-[calc(100dvh-20rem)] min-h-[28rem] flex-col gap-0 overflow-hidden p-0 sm:h-[min(700px,calc(100dvh-15rem))] sm:min-h-[32rem]">
      {/* Encabezado */}
      <div className="flex min-h-16 items-center gap-3 border-b border-border bg-card/95 px-4 py-3">
        <div className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
          <Bot className="size-4.5 text-primary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{assistantName}</p>
          <p className="text-xs text-muted-foreground">
            {enabled ? "Chat de prueba" : "Agente desactivado"}
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmClear(true)}
            disabled={sending}
          >
            <RotateCcw className="size-4" />
            <span className="hidden sm:inline">Reiniciar</span>
          </Button>
        )}
      </div>

      {/* Avisos de estado */}
      {!enabled && (
        <div className="flex items-start gap-2 border-b bg-muted/60 px-4 py-2.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            El agente está desactivado. Activalo en la pestaña{" "}
            <strong>Configuración</strong> para probarlo.
          </p>
        </div>
      )}
      {enabled && !configured && (
        <div className="flex items-start gap-2 border-b bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Las respuestas automáticas están en modo demo o falta completar el
            proveedor de IA. La prueba falla de forma segura hasta que esté listo.
          </p>
        </div>
      )}
      {humanTakeover && (
        <div className="flex items-start gap-2 border-b bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            El agente marcó esta conversación para atención humana. Podés
            seguir probando o reiniciar la conversación.
          </p>
        </div>
      )}

      {/* Mensajes */}
      <div ref={scrollRef} className="conversation-canvas flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5">
        {messages.length === 0 && !sending ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl border border-primary/15 bg-primary/10">
              <Bot className="size-6 text-primary" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-medium">Probá a {assistantName}</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Escribí como si fueras un cliente. El agente responde solo con
                la información cargada en tu negocio.
              </p>
            </div>
            {enabled && (
              <div className="mt-2 max-w-[85%] rounded-xl rounded-bl-sm border border-border bg-card px-3.5 py-2.5 text-left text-sm leading-relaxed shadow-sm">
                {welcomeMessage}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex items-end gap-2",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {message.role === "assistant" && (
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Bot className="size-3.5 text-primary" aria-hidden />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[84%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm",
                    message.role === "user"
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm border border-primary/20 bg-primary/10"
                  )}
                >
                  {message.content}
                  <span
                    className={cn(
                      "mt-1 block text-right text-[10px] leading-none",
                      message.role === "user"
                        ? "text-primary-foreground/60"
                        : "text-muted-foreground"
                    )}
                  >
                    {message.timeLabel}
                  </span>
                </div>
                {message.role === "user" && (
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <UserRound className="size-3.5 text-primary" aria-hidden />
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex items-end gap-2">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Bot className="size-3.5 text-muted-foreground" aria-hidden />
                </div>
                <div className="rounded-lg rounded-bl-sm bg-muted px-3 py-2">
                  <TypingIndicator />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 border-t bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      )}

      {/* Entrada */}
      <form
        className="flex items-end gap-2 border-t border-border bg-card p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Textarea
          ref={textareaRef}
          value={input}
          disabled={!enabled || sending}
          maxLength={MAX_CHAT_MESSAGE_LENGTH}
          rows={1}
          placeholder={
            enabled
              ? "Escribí un mensaje como cliente…"
              : "Activá el agente para escribir"
          }
          className="max-h-[140px] min-h-10 flex-1 resize-none"
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
          aria-label="Mensaje para el agente"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!canSend || input.trim().length === 0}
          aria-label="Enviar mensaje"
        >
          <SendHorizonal className="size-4" />
        </Button>
      </form>
      {input.length > MAX_CHAT_MESSAGE_LENGTH - 100 && (
        <p className="px-4 pb-2 text-right text-xs text-muted-foreground">
          {input.length}/{MAX_CHAT_MESSAGE_LENGTH}
        </p>
      )}

      <ConfirmDeleteDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Reiniciar conversación"
        description="El chat de prueba va a arrancar de cero. El historial queda guardado en la base de datos."
        confirmLabel="Reiniciar"
        pending={clearing}
        onConfirm={handleClear}
      />
    </Card>
  );
}
