"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { productSchema, type ProductInput } from "@/lib/validations/product";
import { createProduct, updateProduct } from "@/server/actions/products";
import type { ProductRow } from "@/server/queries";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/forms/field-error";
import { SubmitButton } from "@/components/forms/submit-button";

type ProductFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductRow | null;
  categories: string[];
};

function toDefaults(product: ProductRow | null): ProductInput {
  return {
    name: product?.name ?? "",
    description: product?.description ?? "",
    price: product?.price ?? 0,
    stock: product?.stock ?? 0,
    category: product?.category ?? "",
    active: product?.active ?? true,
  };
}

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  categories,
}: ProductFormDialogProps) {
  const isEditing = product !== null;
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: toDefaults(product),
  });

  useEffect(() => {
    if (open) reset(toDefaults(product));
  }, [open, product, reset]);

  async function onSubmit(values: ProductInput) {
    const result = isEditing
      ? await updateProduct(product.id, values)
      : await createProduct(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(isEditing ? "Producto actualizado." : "Producto creado.");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar producto" : "Nuevo producto"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Actualizá la información del producto."
              : "Completá los datos del producto para agregarlo al catálogo."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="product-name">Nombre</Label>
            <Input
              id="product-name"
              placeholder="Shampoo reparador 500 ml"
              aria-invalid={Boolean(errors.name)}
              {...register("name")}
            />
            <FieldError message={errors.name?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-description">
              Descripción{" "}
              <span className="font-normal text-muted-foreground">
                (opcional)
              </span>
            </Label>
            <Textarea
              id="product-description"
              rows={3}
              placeholder="Detalles que el agente puede usar al responder."
              aria-invalid={Boolean(errors.description)}
              {...register("description")}
            />
            <FieldError message={errors.description?.message} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="product-price">Precio</Label>
              <Input
                id="product-price"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                aria-invalid={Boolean(errors.price)}
                {...register("price", { valueAsNumber: true })}
              />
              <FieldError message={errors.price?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-stock">Stock</Label>
              <Input
                id="product-stock"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                aria-invalid={Boolean(errors.stock)}
                {...register("stock", { valueAsNumber: true })}
              />
              <FieldError message={errors.stock?.message} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-category">
              Categoría{" "}
              <span className="font-normal text-muted-foreground">
                (opcional)
              </span>
            </Label>
            <Input
              id="product-category"
              list="product-categories"
              placeholder="Cuidado capilar"
              aria-invalid={Boolean(errors.category)}
              {...register("category")}
            />
            <datalist id="product-categories">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
            <FieldError message={errors.category?.message} />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-muted/30 px-3.5 py-3">
            <div>
              <Label htmlFor="product-active">Producto activo</Label>
              <p className="text-xs text-muted-foreground">
                Los productos inactivos no se muestran al agente.
              </p>
            </div>
            <Controller
              control={control}
              name="active"
              render={({ field }) => (
                <Switch
                  id="product-active"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <SubmitButton loading={isSubmitting}>
              {isEditing ? "Guardar cambios" : "Crear producto"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
