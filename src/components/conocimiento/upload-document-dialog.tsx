"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, FileText, X } from "lucide-react";
import { toast } from "sonner";
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
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  TOO_LARGE_MESSAGE,
  UPLOAD_ACCEPT,
} from "@/lib/knowledge-constants";
import { formatFileSize } from "@/lib/format";
import { cn } from "@/lib/utils";

type UploadDocumentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: string[];
  initialFile?: File | null;
};

function validateClientSide(file: File): string | null {
  const dot = file.name.toLowerCase().lastIndexOf(".");
  const ext = dot >= 0 ? file.name.toLowerCase().slice(dot) : "";
  if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
    return "Formato no permitido. Solo se aceptan PDF, DOCX o TXT.";
  }
  if (file.size <= 0) return "El archivo está vacío.";
  if (file.size > MAX_UPLOAD_BYTES) return TOO_LARGE_MESSAGE;
  return null;
}

export function UploadDocumentDialog({
  open,
  onOpenChange,
  categories,
  initialFile = null,
}: UploadDocumentDialogProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Reset al abrir (patrón de ajuste de estado durante el render).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFile(initialFile);
      setCategory("");
      setDragOver(false);
    }
  }

  function selectFile(candidate: File | null | undefined) {
    if (!candidate) return;
    const error = validateClientSide(candidate);
    if (error) {
      toast.error(error);
      return;
    }
    setFile(candidate);
  }

  async function handleUpload() {
    if (!file || uploading) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (category.trim()) formData.append("category", category.trim());

      const response = await fetch("/api/knowledge/documents", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok) {
        toast.error(data.message ?? "No se pudo subir el documento.");
        return;
      }
      toast.success("Documento subido. Se está procesando…");
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("No se pudo subir el documento. Revisá tu conexión.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Subir documento</DialogTitle>
          <DialogDescription>
            PDF con texto, DOCX o TXT (hasta {MAX_UPLOAD_MB} MB). El agente usará
            su contenido solo cuando el documento quede listo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              selectFile(event.dataTransfer.files?.[0]);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              dragOver
                ? "border-primary bg-primary/10"
                : "border-border bg-card/60 hover:border-primary/40"
            )}
          >
            <CloudUpload className="size-7 text-primary" aria-hidden />
            <p className="mt-2 text-sm font-medium">
              Arrastrá un archivo o hacé clic para elegirlo
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              PDF, DOCX o TXT · máx {MAX_UPLOAD_MB} MB
            </p>
            <input
              ref={inputRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              className="sr-only"
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
          </div>

          {file && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
              <FileText className="size-5 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Quitar archivo"
                onClick={() => setFile(null)}
                disabled={uploading}
              >
                <X className="size-4" />
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="upload-category">
              Categoría{" "}
              <span className="font-normal text-muted-foreground">
                (opcional)
              </span>
            </Label>
            <Input
              id="upload-category"
              list="knowledge-upload-categories"
              placeholder="Por ejemplo: Políticas, Manuales…"
              value={category}
              maxLength={60}
              onChange={(event) => setCategory(event.target.value)}
            />
            <datalist id="knowledge-upload-categories">
              {categories.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={uploading}
          >
            Cancelar
          </Button>
          <SubmitButton
            type="button"
            loading={uploading}
            disabled={!file}
            onClick={handleUpload}
          >
            Subir documento
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
