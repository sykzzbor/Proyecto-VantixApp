"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { faqSchema, type FaqInput } from "@/lib/validations/faq";
import { createFaq, updateFaq } from "@/server/actions/faqs";
import type { FaqRow } from "@/server/queries";
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

type FaqFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  faq: FaqRow | null;
  categories: string[];
};

function toDefaults(faq: FaqRow | null): FaqInput {
  return {
    question: faq?.question ?? "",
    answer: faq?.answer ?? "",
    category: faq?.category ?? "",
    active: faq?.active ?? true,
  };
}

export function FaqFormDialog({
  open,
  onOpenChange,
  faq,
  categories,
}: FaqFormDialogProps) {
  const isEditing = faq !== null;
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FaqInput>({
    resolver: zodResolver(faqSchema),
    defaultValues: toDefaults(faq),
  });

  useEffect(() => {
    if (open) reset(toDefaults(faq));
  }, [open, faq, reset]);

  async function onSubmit(values: FaqInput) {
    const result = isEditing
      ? await updateFaq(faq.id, values)
      : await createFaq(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(isEditing ? "Pregunta actualizada." : "Pregunta creada.");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar pregunta" : "Nueva pregunta frecuente"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Actualizá la pregunta o su respuesta."
              : "Cargá una consulta común y la respuesta que debe dar el agente."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="faq-question">Pregunta</Label>
            <Input
              id="faq-question"
              placeholder="¿Cuáles son los horarios de atención?"
              aria-invalid={Boolean(errors.question)}
              {...register("question")}
            />
            <FieldError message={errors.question?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="faq-answer">Respuesta</Label>
            <Textarea
              id="faq-answer"
              rows={4}
              placeholder="La respuesta exacta que debe dar el agente."
              aria-invalid={Boolean(errors.answer)}
              {...register("answer")}
            />
            <FieldError message={errors.answer?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="faq-category">
              Categoría{" "}
              <span className="font-normal text-muted-foreground">
                (opcional)
              </span>
            </Label>
            <Input
              id="faq-category"
              list="faq-categories"
              placeholder="Horarios"
              aria-invalid={Boolean(errors.category)}
              {...register("category")}
            />
            <datalist id="faq-categories">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
            <FieldError message={errors.category?.message} />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/80 bg-muted/30 px-3.5 py-3">
            <div>
              <Label htmlFor="faq-active">Pregunta activa</Label>
              <p className="text-xs text-muted-foreground">
                Las preguntas inactivas no se muestran al agente.
              </p>
            </div>
            <Controller
              control={control}
              name="active"
              render={({ field }) => (
                <Switch
                  id="faq-active"
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
              {isEditing ? "Guardar cambios" : "Crear pregunta"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
