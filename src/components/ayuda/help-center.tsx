"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Bot, CalendarClock, CircleHelp, MessageSquareText, Plug, Search, Settings2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SUPPORT_WHATSAPP_URL } from "@/components/public/public-footer";

const GUIDES = [
  { title: "Conectar un canal de WhatsApp", description: "Revisá los métodos disponibles y el estado del webhook.", href: "/dashboard/integraciones", category: "Integraciones", icon: Plug },
  { title: "Configurar el agente", description: "Definí identidad, mensajes base y reglas de derivación.", href: "/dashboard/agente", category: "Agente IA", icon: Bot },
  { title: "Cargar conocimiento", description: "Prepará documentos que el agente puede consultar.", href: "/dashboard/conocimiento", category: "Agente IA", icon: BookOpen },
  { title: "Preparar Google Calendar", description: "Conectá la cuenta, definí la disponibilidad y administrá reservas.", href: "/dashboard/integraciones/google-calendar", category: "Integraciones", icon: CalendarClock },
  { title: "Probar una conversación", description: "Validá respuestas del agente antes de atender clientes.", href: "/dashboard/agente?vista=chat", category: "Primeros pasos", icon: MessageSquareText },
  { title: "Administrar la organización", description: "Actualizá cuenta, apariencia y seguridad del espacio.", href: "/dashboard/configuracion", category: "Configuración", icon: Settings2 },
] as const;

export function HelpCenter() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    if (!normalized) return GUIDES;
    return GUIDES.filter((guide) =>
      `${guide.title} ${guide.description} ${guide.category}`.toLocaleLowerCase("es").includes(normalized)
    );
  }, [query]);

  return (
    <div className="space-y-6">
      <div className="relative max-w-2xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar una guía o configuración…"
          className="h-11 bg-card pl-9"
          aria-label="Buscar en el centro de ayuda"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
          <CircleHelp className="mx-auto size-7 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm font-medium">No encontramos una guía con ese término</p>
          <p className="mt-1 text-xs text-muted-foreground">Probá con “WhatsApp”, “agente” o “turnos”.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((guide) => {
            const Icon = guide.icon;
            return (
              <Link
                key={guide.title}
                href={guide.href}
                className="group rounded-xl border border-border bg-card p-4 transition-[border-color,background-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-primary/30 hover:bg-accent/25 hover:shadow-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{guide.category}</span>
                </div>
                <h3 className="mt-4 text-sm font-semibold group-hover:text-primary">{guide.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{guide.description}</p>
              </Link>
            );
          })}
        </div>
      )}

      <section className="grid gap-4 rounded-xl border border-border bg-muted/35 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <h3 className="text-sm font-semibold">¿Necesitás una revisión más específica?</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Revisá primero el diagnóstico de Integraciones: muestra qué paso real está pendiente sin exponer credenciales.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/dashboard/integraciones" className="text-sm font-semibold text-primary hover:underline">
            Abrir diagnóstico
          </Link>
          <a
            href={SUPPORT_WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-primary hover:underline"
          >
            Hablar por WhatsApp
          </a>
        </div>
      </section>
    </div>
  );
}
