"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal, Package, Plus, Search, SearchX, X } from "lucide-react";
import { toast } from "sonner";
import { deleteProduct, toggleProductActive } from "@/server/actions/products";
import type { ProductRow } from "@/server/queries";
import { ActiveBadge } from "@/components/dashboard/active-badge";
import { ConfirmDeleteDialog } from "@/components/dashboard/confirm-delete-dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar productos…"
            className="pl-8"
            defaultValue={filters.q}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Buscar productos"
          />
        </div>
        {categories.length > 0 && (
          <Select
            value={filters.category || "todas"}
            onValueChange={(value) =>
              setParam("categoria", value === "todas" ? null : value)
            }
          >
            <SelectTrigger className="w-44" aria-label="Filtrar por categoría">
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
          <SelectTrigger className="w-36" aria-label="Filtrar por estado">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="activos">Activos</SelectItem>
            <SelectItem value="inactivos">Inactivos</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X className="size-4" />
            Limpiar
          </Button>
        )}
        {canWrite && (
          <Button onClick={openCreate} className="ml-auto">
            <Plus className="size-4" />
            Nuevo producto
          </Button>
        )}
      </div>

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
        <div className="overflow-x-auto rounded-lg border bg-background">
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
