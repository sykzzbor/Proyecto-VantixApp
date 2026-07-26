"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tag as TagIcon } from "lucide-react";
import type { CrmTagSummary } from "@/server/crm";
import { createTag, deleteTag, updateTag } from "@/server/actions/crm";
import { TAG_COLORS, MAX_TAGS_PER_ORGANIZATION } from "@/lib/validations/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Catálogo de etiquetas de la organización.
 *
 * Solo se muestra a quien puede administrarlas; el servidor vuelve a
 * verificar el permiso en cada acción.
 */
export function TagManager({ tags }: { tags: CrmTagSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TAG_COLORS[4]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string>(TAG_COLORS[0]);

  const lleno = tags.length >= MAX_TAGS_PER_ORGANIZATION;

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    exito: string,
    onOk?: () => void
  ) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "No se pudo completar la acción.");
        return;
      }
      toast.success(exito);
      onOk?.();
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
          <TagIcon className="size-4 text-primary" aria-hidden />
        </div>
        <CardTitle className="mt-2 text-base">Etiquetas del CRM</CardTitle>
        <CardDescription>
          Se aplican a conversaciones y clientes para agruparlos y filtrarlos.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        <div className="space-y-2">
          <Label htmlFor="tag-name">Nueva etiqueta</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="tag-name"
              value={name}
              maxLength={40}
              placeholder="Ej.: Cliente frecuente"
              onChange={(event) => setName(event.target.value)}
              className="sm:flex-1"
            />
            <div
              className="flex items-center gap-1.5"
              role="radiogroup"
              aria-label="Color de la etiqueta"
            >
              {TAG_COLORS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={color === value}
                  aria-label={`Color ${value}`}
                  onClick={() => setColor(value)}
                  className={
                    color === value
                      ? "size-7 rounded-full ring-2 ring-foreground ring-offset-2 ring-offset-background"
                      : "size-7 rounded-full opacity-70 hover:opacity-100"
                  }
                  style={{ backgroundColor: value }}
                />
              ))}
            </div>
            <Button
              disabled={pending || name.trim().length < 2 || lleno}
              onClick={() =>
                run(() => createTag({ name, color }), "Etiqueta creada.", () =>
                  setName("")
                )
              }
            >
              Crear
            </Button>
          </div>
          {lleno && (
            <p className="text-xs text-muted-foreground">
              Llegaste al máximo de {MAX_TAGS_PER_ORGANIZATION} etiquetas.
            </p>
          )}
        </div>

        {tags.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
            Todavía no creaste etiquetas.
          </p>
        ) : (
          <ul className="space-y-2">
            {tags.map((tag) => (
              <li
                key={tag.id}
                className="rounded-lg border border-border/75 bg-background/35 p-3"
              >
                {editingId === tag.id ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      value={editName}
                      maxLength={40}
                      onChange={(event) => setEditName(event.target.value)}
                      className="sm:flex-1"
                    />
                    <div className="flex items-center gap-1.5">
                      {TAG_COLORS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-label={`Color ${value}`}
                          onClick={() => setEditColor(value)}
                          className={
                            editColor === value
                              ? "size-6 rounded-full ring-2 ring-foreground ring-offset-2 ring-offset-background"
                              : "size-6 rounded-full opacity-70 hover:opacity-100"
                          }
                          style={{ backgroundColor: value }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={pending || editName.trim().length < 2}
                        onClick={() =>
                          run(
                            () =>
                              updateTag({
                                id: tag.id,
                                name: editName,
                                color: editColor,
                              }),
                            "Etiqueta actualizada.",
                            () => setEditingId(null)
                          )
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
                  <div className="flex flex-wrap items-center gap-3">
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
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {tag.usageCount === 0
                        ? "Sin usar"
                        : `En uso en ${tag.usageCount} ficha${tag.usageCount === 1 ? "" : "s"}`}
                    </span>
                    <div className="ml-auto flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => {
                          setEditingId(tag.id);
                          setEditName(tag.name);
                          setEditColor(tag.color);
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={pending}
                        onClick={() =>
                          run(() => deleteTag(tag.id), "Etiqueta eliminada.")
                        }
                      >
                        Eliminar
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
