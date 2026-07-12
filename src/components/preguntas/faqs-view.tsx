"use client";

import { useState, useTransition } from "react";
import {
  MessageCircleQuestion,
  MoreHorizontal,
  Plus,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { deleteFaq, toggleFaqActive } from "@/server/actions/faqs";
import type { FaqRow } from "@/server/queries";
import { ActiveBadge } from "@/components/dashboard/active-badge";
import { ConfirmDeleteDialog } from "@/components/dashboard/confirm-delete-dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { useTableFilters } from "@/components/dashboard/use-table-filters";
import { FaqFormDialog } from "@/components/preguntas/faq-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type FaqsViewProps = {
  faqs: FaqRow[];
  categories: string[];
  canWrite: boolean;
  canDelete: boolean;
  filters: { q: string; category: string; status: string };
};

export function FaqsView({
  faqs,
  categories,
  canWrite,
  canDelete,
  filters,
}: FaqsViewProps) {
  const { setParam, setSearch, clearAll } = useTableFilters();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FaqRow | null>(null);
  const [deleting, setDeleting] = useState<FaqRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasFilters = Boolean(filters.q || filters.category || filters.status);
  const showActions = canWrite || canDelete;

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function handleToggle(faq: FaqRow) {
    startTransition(async () => {
      const result = await toggleFaqActive({ id: faq.id, active: !faq.active });
      if (result.ok) {
        toast.success(faq.active ? "Pregunta desactivada." : "Pregunta activada.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete() {
    if (!deleting) return;
    startTransition(async () => {
      const result = await deleteFaq(deleting.id);
      if (result.ok) {
        toast.success("Pregunta eliminada.");
        setDeleting(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar preguntas…"
            className="pl-8"
            defaultValue={filters.q}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Buscar preguntas"
          />
        </div>
        {categories.length > 0 && (
          <Select
            value={filters.category || "todas"}
            onValueChange={(value) =>
              setParam("categoria", value === "todas" ? null : value)
            }
          >
            <SelectTrigger className="w-full sm:w-44" aria-label="Filtrar por categoría">
              <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las categorías</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={filters.status || "todos"}
          onValueChange={(value) =>
            setParam("estado", value === "todos" ? null : value)
          }
        >
          <SelectTrigger className="w-full sm:w-36" aria-label="Filtrar por estado">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas</SelectItem>
            <SelectItem value="activos">Activas</SelectItem>
            <SelectItem value="inactivos">Inactivas</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="w-full sm:w-auto">
            <X className="size-4" />
            Limpiar
          </Button>
        )}
        {canWrite && (
          <Button onClick={openCreate} className="w-full sm:ml-auto sm:w-auto">
            <Plus className="size-4" />
            Nueva pregunta
          </Button>
        )}
      </div>

      {faqs.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={SearchX}
            title="Sin resultados"
            description="Ninguna pregunta coincide con la búsqueda o los filtros aplicados."
          >
            <Button variant="outline" onClick={clearAll}>
              Limpiar filtros
            </Button>
          </EmptyState>
        ) : (
          <EmptyState
            icon={MessageCircleQuestion}
            title="Todavía no hay preguntas frecuentes"
            description="Cargá las consultas más comunes de tus clientes con sus respuestas para entrenar al agente."
          >
            {canWrite && (
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                Agregar pregunta
              </Button>
            )}
          </EmptyState>
        )
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pregunta</TableHead>
                <TableHead className="hidden md:table-cell">
                  Categoría
                </TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="hidden lg:table-cell">
                  Actualizada
                </TableHead>
                {showActions && (
                  <TableHead className="w-12">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {faqs.map((faq) => (
                <TableRow key={faq.id}>
                  <TableCell>
                    <p className="max-w-md font-medium">{faq.question}</p>
                    <p className="line-clamp-1 max-w-md text-xs text-muted-foreground">
                      {faq.answer}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {faq.category ? (
                      <Badge variant="secondary" className="font-normal">
                        {faq.category}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ActiveBadge
                      active={faq.active}
                      activeLabel="Activa"
                      inactiveLabel="Inactiva"
                    />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {faq.updatedAtLabel}
                  </TableCell>
                  {showActions && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Acciones para la pregunta ${faq.question}`}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canWrite && (
                            <>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditing(faq);
                                  setFormOpen(true);
                                }}
                              >
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={isPending}
                                onSelect={() => handleToggle(faq)}
                              >
                                {faq.active ? "Desactivar" : "Activar"}
                              </DropdownMenuItem>
                            </>
                          )}
                          {canWrite && canDelete && <DropdownMenuSeparator />}
                          {canDelete && (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setDeleting(faq)}
                            >
                              Eliminar
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <FaqFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        faq={editing}
        categories={categories}
      />

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Eliminar pregunta"
        description={
          deleting
            ? `Vas a eliminar la pregunta “${deleting.question}” de forma permanente. Esta acción no se puede deshacer.`
            : ""
        }
        pending={isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
