"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal, Package, Plus, SearchX, X } from "lucide-react";
import { toast } from "sonner";
import { deleteProduct, toggleProductActive } from "@/server/actions/products";
import type { ProductRow } from "@/server/queries";
import { ActiveBadge } from "@/components/dashboard/active-badge";
import { ConfirmDeleteDialog } from "@/components/dashboard/confirm-delete-dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { EntityToolbar } from "@/components/dashboard/entity-toolbar";
import { ReadOnlyNotice } from "@/components/dashboard/read-only-notice";
import { useTableFilters } from "@/components/dashboard/use-table-filters";
import { ProductFormDialog } from "@/components/productos/product-form-dialog";
import { Badge } from "@/components/ui/badge";
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

type ProductsViewProps = {
  products: ProductRow[];
  categories: string[];
  canWrite: boolean;
  canDelete: boolean;
  filters: { q: string; category: string; status: string };
};

export function ProductsView({
  products,
  categories,
  canWrite,
  canDelete,
  filters,
}: ProductsViewProps) {
  const { setParam, setSearch, clearAll } = useTableFilters();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [deleting, setDeleting] = useState<ProductRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasFilters = Boolean(filters.q || filters.category || filters.status);
  const showActions = canWrite || canDelete;
  const activeCount = products.filter((product) => product.active).length;

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(product: ProductRow) {
    setEditing(product);
    setFormOpen(true);
  }

  function handleToggle(product: ProductRow) {
    startTransition(async () => {
      const result = await toggleProductActive({
        id: product.id,
        active: !product.active,
      });
      if (result.ok) {
        toast.success(
          product.active ? "Producto desactivado." : "Producto activado."
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete() {
    if (!deleting) return;
    startTransition(async () => {
      const result = await deleteProduct(deleting.id);
      if (result.ok) {
        toast.success("Producto eliminado.");
        setDeleting(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {!canWrite && (
        <ReadOnlyNotice message="Podés consultar el catálogo, pero tu rol no permite crear ni editar productos." />
      )}

      <EntityToolbar
        searchLabel="Buscar productos"
        searchPlaceholder="Buscar productos…"
        defaultSearch={filters.q}
        onSearchChange={setSearch}
        summary={`${products.length} ${products.length === 1 ? "producto visible" : "productos visibles"} · ${activeCount} activos`}
        filters={
          <>
            {categories.length > 0 && (
          <Select
            value={filters.category || "todas"}
            onValueChange={(value) =>
              setParam("categoria", value === "todas" ? null : value)
            }
          >
            <SelectTrigger className="w-full lg:w-44" aria-label="Filtrar por categoría">
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
          <SelectTrigger className="w-full lg:w-36" aria-label="Filtrar por estado">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="activos">Activos</SelectItem>
            <SelectItem value="inactivos">Inactivos</SelectItem>
          </SelectContent>
            </Select>
          </>
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
                Nuevo producto
              </Button>
            )}
          </>
        }
      />

      {products.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={SearchX}
            title="Sin resultados"
            description="Ningún producto coincide con la búsqueda o los filtros aplicados."
          >
            <Button variant="outline" onClick={clearAll}>
              Limpiar filtros
            </Button>
          </EmptyState>
        ) : (
          <EmptyState
            icon={Package}
            title="Todavía no hay productos"
            description="Cargá tu catálogo para que el agente pueda responder consultas sobre precios y stock."
          >
            {canWrite && (
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                Agregar producto
              </Button>
            )}
          </EmptyState>
        )
      ) : (
        <>
        <div className="grid gap-3 xl:hidden">
          {products.map((product) => (
            <article
              key={product.id}
              className="rounded-xl border border-border/85 bg-card p-4 shadow-[0_14px_38px_-34px_rgba(0,0,0,0.95)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold leading-snug">{product.name}</h3>
                    <ActiveBadge active={product.active} />
                  </div>
                  {product.description && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {product.description}
                    </p>
                  )}
                </div>
                {showActions && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Acciones para ${product.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canWrite && (
                        <>
                          <DropdownMenuItem onSelect={() => openEdit(product)}>Editar</DropdownMenuItem>
                          <DropdownMenuItem disabled={isPending} onSelect={() => handleToggle(product)}>
                            {product.active ? "Desactivar" : "Activar"}
                          </DropdownMenuItem>
                        </>
                      )}
                      {canWrite && canDelete && <DropdownMenuSeparator />}
                      {canDelete && (
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(product)}>
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
                  <dd className="mt-1 text-sm font-semibold tabular-nums">{product.priceLabel}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Disponibilidad</dt>
                  <dd className={product.stock === 0 ? "mt-1 text-sm font-medium text-destructive" : "mt-1 text-sm font-medium"}>
                    {product.stock === 0 ? "Sin stock" : `${product.stock} unidades`}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Categoría</dt>
                  <dd className="mt-1 truncate">{product.category ?? "Sin categoría"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Actualizado</dt>
                  <dd className="mt-1">{product.updatedAtLabel}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>

        <div className="hidden overflow-hidden rounded-xl border border-border bg-card xl:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="hidden md:table-cell">
                  Categoría
                </TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Stock
                </TableHead>
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
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <p className="font-medium">{product.name}</p>
                    {product.description && (
                      <p className="line-clamp-1 max-w-xs text-xs text-muted-foreground">
                        {product.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {product.category ? (
                      <Badge variant="secondary" className="font-normal">
                        {product.category}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {product.priceLabel}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {product.stock === 0 ? (
                      <span className="text-destructive">Sin stock</span>
                    ) : (
                      product.stock
                    )}
                  </TableCell>
                  <TableCell>
                    <ActiveBadge active={product.active} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {product.updatedAtLabel}
                  </TableCell>
                  {showActions && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Acciones para ${product.name}`}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canWrite && (
                            <>
                              <DropdownMenuItem
                                onSelect={() => openEdit(product)}
                              >
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={isPending}
                                onSelect={() => handleToggle(product)}
                              >
                                {product.active ? "Desactivar" : "Activar"}
                              </DropdownMenuItem>
                            </>
                          )}
                          {canWrite && canDelete && <DropdownMenuSeparator />}
                          {canDelete && (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setDeleting(product)}
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

      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        product={editing}
        categories={categories}
      />

      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Eliminar producto"
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
