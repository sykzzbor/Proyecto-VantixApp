"use client";

import { useState, useTransition } from "react";
import { Briefcase, MoreHorizontal, Plus, SearchX, X } from "lucide-react";
import { toast } from "sonner";
import { deleteService, toggleServiceActive } from "@/server/actions/services";
import type { ServiceRow } from "@/server/queries";
import { ActiveBadge } from "@/components/dashboard/active-badge";
import { ConfirmDeleteDialog } from "@/components/dashboard/confirm-delete-dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { EntityToolbar } from "@/components/dashboard/entity-toolbar";
import { ReadOnlyNotice } from "@/components/dashboard/read-only-notice";
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
  const activeCount = services.filter((service) => service.active).length;

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
      {!canWrite && (
        <ReadOnlyNotice message="Podés consultar los servicios, pero tu rol no permite crearlos ni modificarlos." />
      )}

      <EntityToolbar
        searchLabel="Buscar servicios"
        searchPlaceholder="Buscar servicios…"
        defaultSearch={filters.q}
        onSearchChange={setSearch}
        summary={`${services.length} ${services.length === 1 ? "servicio visible" : "servicios visibles"} · ${activeCount} activos`}
        filters={
          <Select
          value={filters.status || "todos"}
          onValueChange={(value) =>
            setParam("estado", value === "todos" ? null : value)
          }
        >
          <SelectTrigger className="w-full lg:w-36" aria-label="Filtrar por estado">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="activos">Activos</SelectItem>
            <SelectItem value="inactivos">Inactivos</SelectItem>
          </SelectContent>
          </Select>
        }
        actions={
          <>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearAll} className="w-full lg:w-auto">
                <X className="size-4" />
                Limpiar
              </Button>
            )}
            {canWrite && (
              <Button onClick={openCreate} className="w-full lg:w-auto">
                <Plus className="size-4" />
                Nuevo servicio
              </Button>
            )}
          </>
        }
      />

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
        <>
        <div className="grid gap-3 xl:hidden">
          {services.map((service) => (
            <article key={service.id} className="rounded-xl border border-border/85 bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold leading-snug">{service.name}</h3>
                    <ActiveBadge active={service.active} />
                  </div>
                  {service.description && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {service.description}
                    </p>
                  )}
                </div>
                {showActions && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Acciones para ${service.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canWrite && (
                        <>
                          <DropdownMenuItem onSelect={() => { setEditing(service); setFormOpen(true); }}>Editar</DropdownMenuItem>
                          <DropdownMenuItem disabled={isPending} onSelect={() => handleToggle(service)}>
                            {service.active ? "Desactivar" : "Activar"}
                          </DropdownMenuItem>
                        </>
                      )}
                      {canWrite && canDelete && <DropdownMenuSeparator />}
                      {canDelete && (
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(service)}>
                          Eliminar
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/70 pt-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Precio</dt>
                  <dd className="mt-1 text-sm font-semibold tabular-nums">{service.priceLabel}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Duración</dt>
                  <dd className="mt-1 text-sm font-medium">{service.durationLabel}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Actualizado</dt>
                  <dd className="mt-1">{service.updatedAtLabel}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>

        <div className="hidden overflow-hidden rounded-xl border border-border bg-card xl:block">
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
        </>
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
