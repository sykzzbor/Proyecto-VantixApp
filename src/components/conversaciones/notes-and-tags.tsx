"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, NotebookPen, Plus, Tag as TagIcon } from "lucide-react";
import type { AppliedTag, ConversationNoteView } from "@/server/crm";
import type { CrmTagSummary } from "@/server/crm";
import {
  createNote,
  deleteNote,
  toggleConversationTag,
  updateNote,
} from "@/server/actions/crm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Notas internas y etiquetas de una conversación.
 *
 * Las notas son del equipo: nunca se envían por ningún canal ni se le
 * muestran al cliente. Los permisos reales los aplica el servidor; acá solo
 * se ocultan los controles que la persona no podría usar.
 */

function cuando(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(iso));
}

export function NotesAndTags({
  conversationId,
  notes,
  appliedTags,
  availableTags,
  currentUserId,
  canWrite,
  canModerate,
}: {
  conversationId: string;
  notes: ConversationNoteView[];
  appliedTags: AppliedTag[];
  availableTags: CrmTagSummary[];
  currentUserId: string;
  /** AGENT o superior: puede etiquetar y anotar. */
  canWrite: boolean;
  /** OWNER o ADMIN: puede editar y borrar notas ajenas. */
  canModerate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const appliedIds = new Set(appliedTags.map((tag) => tag.id));

  function run(action: () => Promise<{ ok: boolean; error?: string }>, exito: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo completar la acción.");
        return;
      }
      toast.success(exito);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Etiquetas */}
      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <TagIcon className="size-3.5" aria-hidden />
            Etiquetas
          </h3>
          {canWrite && availableTags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" disabled={pending}>
                  <Plus className="size-3.5" aria-hidden />
                  Aplicar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
                {availableTags.map((tag) => {
                  const applied = appliedIds.has(tag.id);
                  return (
                    <DropdownMenuItem
                      key={tag.id}
                      onSelect={(event) => {
                        event.preventDefault();
                        run(
                          () =>
                            toggleConversationTag({
                              conversationId,
                              tagId: tag.id,
                              applied: !applied,
                            }),
                          applied ? "Etiqueta quitada." : "Etiqueta aplicada."
                        );
                      }}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                        aria-hidden
                      />
                      <span className="flex-1 truncate">{tag.name}</span>
                      {applied && <Check className="size-3.5" aria-hidden />}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {appliedTags.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {availableTags.length === 0
              ? "Todavía no hay etiquetas. Se crean desde Configuración."
              : "Sin etiquetas."}
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {appliedTags.map((tag) => (
              <li key={tag.id}>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                  style={{ borderColor: `${tag.color}66`, color: tag.color }}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                    aria-hidden
                  />
                  {tag.name}
                  {canWrite && (
                    <button
                      type="button"
                      className="ml-0.5 opacity-60 hover:opacity-100"
                      disabled={pending}
                      aria-label={`Quitar ${tag.name}`}
                      onClick={() =>
                        run(
                          () =>
                            toggleConversationTag({
                              conversationId,
                              tagId: tag.id,
                              applied: false,
                            }),
                          "Etiqueta quitada."
                        )
                      }
                    >
                      ×
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Notas internas */}
      <section>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <NotebookPen className="size-3.5" aria-hidden />
          Notas internas
        </h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Solo las ve tu equipo. No se envían al cliente.
        </p>

        {canWrite && (
          <div className="mt-3 space-y-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ej.: pidió factura A, llamar después de las 18 h."
              rows={3}
              maxLength={2000}
              className="text-sm"
            />
            <Button
              size="sm"
              disabled={pending || draft.trim().length === 0}
              onClick={() =>
                run(async () => {
                  const result = await createNote({
                    conversationId,
                    body: draft,
                  });
                  if (result.ok) setDraft("");
                  return result;
                }, "Nota guardada.")
              }
            >
              Guardar nota
            </Button>
          </div>
        )}

        {notes.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Todavía no hay notas en esta conversación.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {notes.map((note) => {
              const propia = note.authorId === currentUserId;
              const editable = canWrite && (propia || canModerate);
              return (
                <li
                  key={note.id}
                  className="rounded-lg border border-border/75 bg-background/35 p-3"
                >
                  {editingId === note.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        rows={3}
                        maxLength={2000}
                        className="text-sm"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={pending || editDraft.trim().length === 0}
                          onClick={() =>
                            run(async () => {
                              const result = await updateNote({
                                id: note.id,
                                body: editDraft,
                              });
                              if (result.ok) setEditingId(null);
                              return result;
                            }, "Nota actualizada.")
                          }
                        >
                          Guardar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap break-words text-sm">
                        {note.body}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="font-medium">{note.authorName}</span>
                        <span>·</span>
                        <span>{cuando(note.createdAt)}</span>
                        {note.editedAt && <span>· editada</span>}
                        {editable && (
                          <>
                            <button
                              type="button"
                              className="ml-auto underline-offset-2 hover:underline"
                              disabled={pending}
                              onClick={() => {
                                setEditingId(note.id);
                                setEditDraft(note.body);
                              }}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="text-destructive underline-offset-2 hover:underline"
                              disabled={pending}
                              onClick={() =>
                                run(() => deleteNote(note.id), "Nota eliminada.")
                              }
                            >
                              Eliminar
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
