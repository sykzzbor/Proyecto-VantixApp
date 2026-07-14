"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getDocumentText,
  renameDocument,
  updateDocumentCategory,
} from "@/server/actions/knowledge";
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
import { SubmitButton } from "@/components/forms/submit-button";

export type DocumentSummary = {
  id: string;
  name: string;
  category: string | null;
};

export function RenameDocumentDialog({
  open,
  onOpenChange,
  document,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: DocumentSummary | null;
}) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [wasOpen, setWasOpen] = useState(false);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && document) setName(document.name);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!document) return;
    startTransition(async () => {
      const result = await renameDocument({ id: document.id, name });
      if (result.ok) {
        toast.success("Documento renombrado.");
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Renombrar documento</DialogTitle>
          <DialogDescription>
            Cambiá el nombre visible del documento. No afecta al archivo original.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="rename-name">Nombre</Label>
            <Input
              id="rename-name"
              value={name}
              maxLength={160}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <SubmitButton loading={isPending} disabled={!name.trim()}>
              Guardar
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CategoryDocumentDialog({
  open,
  onOpenChange,
  document,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: DocumentSummary | null;
  categories: string[];
}) {
  const [category, setCategory] = useState("");
  const [isPending, startTransition] = useTransition();
  const [wasOpen, setWasOpen] = useState(false);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && document) setCategory(document.category ?? "");
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!document) return;
    startTransition(async () => {
      const result = await updateDocumentCategory({
        id: document.id,
        category,
      });
      if (result.ok) {
        toast.success("Categoría actualizada.");
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar categoría</DialogTitle>
          <DialogDescription>
            Agrupá los documentos por categoría. Dejala vacía para quitarla.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="category-name">
              Categoría{" "}
              <span className="font-normal text-muted-foreground">
                (opcional)
              </span>
            </Label>
            <Input
              id="category-name"
              list="knowledge-category-options"
              value={category}
              maxLength={60}
              autoFocus
              onChange={(event) => setCategory(event.target.value)}
            />
            <datalist id="knowledge-category-options">
              {categories.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <SubmitButton loading={isPending}>Guardar</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentTextDialog({
  open,
  onOpenChange,
  documentId,
  documentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string | null;
  documentName: string;
}) {
  const [state, setState] = useState<{
    loading: boolean;
    text?: string;
    error?: string;
  }>({ loading: true });

  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setState({ loading: true });
  }

  useEffect(() => {
    if (!open || !documentId) return;
    let active = true;
    getDocumentText(documentId).then((result) => {
      if (!active) return;
      if (result.ok) setState({ loading: false, text: result.text });
      else setState({ loading: false, error: result.error });
    });
    return () => {
      active = false;
    };
  }, [open, documentId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{documentName}</DialogTitle>
          <DialogDescription>
            Texto extraído que el agente puede consultar. No es el archivo
            original.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] min-h-40 overflow-y-auto rounded-lg border border-border bg-background/60 p-4">
          {state.loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Cargando texto…
            </div>
          ) : state.error ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {state.error}
            </p>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
              {state.text}
            </pre>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
