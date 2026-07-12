"use client";

import { useState, useTransition } from "react";
import { Briefcase, MoreHorizontal, Plus, Search, SearchX, X } from "lucide-react";
import { toast } from "sonner";
import { deleteService, toggleServiceActive } from "@/server/actions/services";
import type { ServiceRow } from "@/server/queries";
import { ActiveBadge } from "@/components/dashboard/active-badge";
import { ConfirmDeleteDialog } from "@/components/dashboard/confirm-delete-dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { useTableFilters } from "@/components/dashboard/use-table-filters";
import { ServiceFormDialog } from "@/components/servicios/service-form-dialog";
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

type ServicesViewProps = {
  services: ServiceRow[];
  canWrite: boolean;
  canDelete: boolean;
  filters: { q: string; status: string };
};

export function ServicesView({
  services,
  canWrite,
  canDelete,
  filters,
}: ServicesViewProps) {
  const { setParam, setSearch, clearAll } = useTableFilters();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [deleting, setDeleting] = useState<ServiceRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasFilters = Boolean(filters.q || filters.status);
  const showActions = canWrite || canDelete;

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function handleToggle(service: ServiceRow) {
    startTransition(async () => {
      const result = await toggleServiceActive({
        id: service.id,
        active: !service.active,
      });
      if (result.ok) {
        toast.success(
          service.active ? "Servicio desactivado." : "Servicio activado."
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete() {
    if (!deleting) return;
    startTransition(async () => {
      const result = await deleteService(deleting.id);
      if (result.ok) {
        toast.success("Servicio eliminado.");
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
            placeholder="Buscar servicios…"
            className="pl-8"
            defaultValue={filters.q}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Buscar servicios"
          />
        </div>
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
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="activos">Activos</SelectItem>
            <SelectItem value="inactivos">Inactivos</SelectItem>
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
            Nuevo servicio
          </Button>
        )}
      </div>

      {services.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={SearchX}
            title="Sin resultados"
            description="Ningún servicio coincide con la búsqueda o los filtros aplicados."
          >
            <Button variant="outline" onClick={clearAll}>
              Limpiar filtros
            </Button>
          </EmptyState>
        ) : (
          <EmptyState
            icon={Briefcase}
            title="Todavía no hay servicios"
            description="Cargá los servicios que ofrecés para que el agente pueda informar precios y duración."
          >
            {canWrite && (
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                Agregar servicio
              </Button>
            )}
          </EmptyState>
        )
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Servicio</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="hidden sm:table-cell">Duración</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="hidden lg:table-cell">
                  Actualizado
                </TableHead>
                {showActions && (
                  <TableHead className="w-12">
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((service) => (
                <TableRow key={service.id}>
                  <TableCell>
                    <p className="font-medium">{service.name}</p>
                    {service.description && (
                      <p className="line-clamp-1 max-w-xs text-xs text-muted-foreground">
                        {service.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {service.priceLabel}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {service.durationLabel}
                  </TableCell>
                  <TableCell>
                    <ActiveBadge active={service.active} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {service.updatedAtLabel}
                  </TableCell>
                  {showActions && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Acciones para ${service.name}`}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canWrite && (
                            <>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEditing(service);
                                  setFormOpen(true);
                                }}
                              >
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={isPending}
                                onSelect={() => handleToggle(service)}
                              >
                                {service.active ? "Desactivar" : "Activar"}
                              </DropdownMenuItem>
                            </>
                          )}
                          {canWrite && canDelete && <DropdownMenuSeparator />}
                          {canDelete && (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setDeleting(service)}
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

      <ServiceFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        service={editing}
      />

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Eliminar servicio"
        description={
          deleting
            ? `Vas a eliminar “${deleting.name}” de forma permanente. Esta acción no se puede deshacer.`
            : ""
        }
        pending={isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
