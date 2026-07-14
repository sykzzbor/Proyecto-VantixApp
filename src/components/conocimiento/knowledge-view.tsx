"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  CloudUpload,
  Eye,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  SearchX,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteDocument,
  retryProcessDocument,
  toggleDocumentEnabled,
} from "@/server/actions/knowledge";
import type { KnowledgeDocumentRow } from "@/server/knowledge/queries";
import { ConfirmDeleteDialog } from "@/components/dashboard/confirm-delete-dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { useTableFilters } from "@/components/dashboard/use-table-filters";
import {
  CategoryDocumentDialog,
  DocumentTextDialog,
  RenameDocumentDialog,
  type DocumentSummary,
} from "@/components/conocimiento/document-dialogs";
import { KnowledgeStatusBadge } from "@/components/conocimiento/knowledge-status-badge";
import { UploadDocumentDialog } from "@/components/conocimiento/upload-document-dialog";
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

const STATUS_LABEL: Record<string, string> = {
  UPLOADED: "En cola",
  PROCESSING: "Procesando",
  READY: "Listo",
  FAILED: "Con error",
  DISABLED: "Desactivado",
};

// Lista local (client-safe) para no importar valores del módulo de queries,
// que depende de Prisma y no debe entrar al bundle del navegador.
const KNOWLEDGE_STATUSES = [
  "UPLOADED",
  "PROCESSING",
  "READY",
  "FAILED",
  "DISABLED",
] as const;

type KnowledgeViewProps = {
  documents: KnowledgeDocumentRow[];
  categories: string[];
  canManage: boolean;
  canDelete: boolean;
  filters: { q: string; status: string; category: string };
};

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span className="text-muted-foreground/70">{label}:</span>
      <span className="text-foreground/80">{value}</span>
    </span>
  );
}

export function KnowledgeView({
  documents,
  categories,
  canManage,
  canDelete,
  filters,
}: KnowledgeViewProps) {
  const router = useRouter();
  const { setParam, setSearch, clearAll } = useTableFilters();
  const [isPending, startTransition] = useTransition();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const [renaming, setRenaming] = useState<DocumentSummary | null>(null);
  const [recategorizing, setRecategorizing] = useState<DocumentSummary | null>(
    null
  );
  const [viewingText, setViewingText] = useState<KnowledgeDocumentRow | null>(
    null
  );
  const [deleting, setDeleting] = useState<KnowledgeDocumentRow | null>(null);

  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replacingIdRef = useRef<string | null>(null);
  const [replacing, setReplacing] = useState(false);

  const hasFilters = Boolean(filters.q || filters.status || filters.category);
  const hasPending = documents.some(
    (document) =>
      document.status === "PROCESSING" || document.status === "UPLOADED"
  );

  // Auto-refresco moderado mientras haya documentos procesándose.
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [hasPending, router]);

  function openUpload(file: File | null) {
    setDroppedFile(file);
    setUploadOpen(true);
  }

  function handleRetry(document: KnowledgeDocumentRow) {
    startTransition(async () => {
      const result = await retryProcessDocument(document.id);
      if (result.ok) toast.success("Procesando el documento…");
      else toast.error(result.error);
    });
  }

  function handleToggle(document: KnowledgeDocumentRow) {
    startTransition(async () => {
      const result = await toggleDocumentEnabled({
        id: document.id,
        enabled: !document.enabled,
      });
      if (result.ok) {
        toast.success(
          document.enabled ? "Documento desactivado." : "Documento activado."
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDelete() {
    if (!deleting) return;
    startTransition(async () => {
      const result = await deleteDocument(deleting.id);
      if (result.ok) {
        toast.success("Documento eliminado.");
        setDeleting(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  function startReplace(id: string) {
    replacingIdRef.current = id;
    replaceInputRef.current?.click();
  }

  async function onReplaceFileSelected(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    const documentId = replacingIdRef.current;
    replacingIdRef.current = null;
    if (!file || !documentId) return;

    setReplacing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(
        `/api/knowledge/documents/${documentId}/file`,
        { method: "POST", body: formData }
      );
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok) {
        toast.error(data.message ?? "No se pudo reemplazar el documento.");
        return;
      }
      toast.success("Documento reemplazado. Se está procesando…");
      router.refresh();
    } catch {
      toast.error("No se pudo reemplazar el documento.");
    } finally {
      setReplacing(false);
    }
  }

  return (
    <div
      className="relative space-y-4"
      onDragOver={(event) => {
        if (!canManage) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        if (!canManage) return;
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) openUpload(file);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-sm font-medium text-primary">
            <CloudUpload className="size-8" aria-hidden />
            Soltá el archivo para subirlo
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar documentos…"
            className="pl-8"
            defaultValue={filters.q}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Buscar documentos"
          />
        </div>
        <Select
          value={filters.status || "todos"}
          onValueChange={(value) =>
            setParam("estado", value === "todos" ? null : value)
          }
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Filtrar por estado">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            {KNOWLEDGE_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABEL[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {categories.length > 0 && (
          <Select
            value={filters.category || "todas"}
            onValueChange={(value) =>
              setParam("categoria", value === "todas" ? null : value)
            }
          >
            <SelectTrigger
              className="w-full sm:w-44"
              aria-label="Filtrar por categoría"
            >
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
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="w-full sm:w-auto"
          >
            <X className="size-4" />
            Limpiar
          </Button>
        )}
        {canManage && (
          <Button
            onClick={() => openUpload(null)}
            className="w-full sm:ml-auto sm:w-auto"
          >
            <Plus className="size-4" />
            Subir documento
          </Button>
        )}
      </div>

      {/* Lista */}
      {documents.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={SearchX}
            title="Sin resultados"
            description="Ningún documento coincide con la búsqueda o los filtros aplicados."
          >
            <Button variant="outline" onClick={clearAll}>
              Limpiar filtros
            </Button>
          </EmptyState>
        ) : (
          <EmptyState
            icon={BookOpen}
            title="Todavía no hay documentos"
            description="Subí manuales, políticas o catálogos para que el agente pueda responder con información confirmada."
          >
            {canManage && (
              <Button onClick={() => openUpload(null)}>
                <Plus className="size-4" />
                Subir documento
              </Button>
            )}
          </EmptyState>
        )
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {documents.map((document) => {
            const showActions =
              canManage || canDelete || document.hasText;
            return (
              <div
                key={document.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex min-w-0 gap-3">
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
                    <FileText className="size-4.5 text-[#8eacff]" aria-hidden />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{document.name}</p>
                      <KnowledgeStatusBadge status={document.status} />
                      {document.availableForAgent && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-primary/20 bg-primary/10 text-[11px] font-normal text-[#8eacff]"
                        >
                          Disponible para el agente
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {document.originalFilename} · {document.formatLabel} ·{" "}
                      {document.sizeLabel}
                    </p>
                    {document.status === "FAILED" && document.processingError && (
                      <p className="text-xs text-destructive">
                        {document.processingError}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                      {document.category && (
                        <MetaItem label="Categoría" value={document.category} />
                      )}
                      <MetaItem
                        label="Fragmentos"
                        value={String(document.chunkCount)}
                      />
                      <MetaItem label="Cargado" value={document.createdAtLabel} />
                      {document.processedAtLabel && (
                        <MetaItem
                          label="Procesado"
                          value={document.processedAtLabel}
                        />
                      )}
                      {document.uploadedByName && (
                        <MetaItem label="Cargó" value={document.uploadedByName} />
                      )}
                    </div>
                  </div>
                </div>

                {showActions && (
                  <div className="shrink-0 self-end sm:self-start">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isPending || replacing}
                          aria-label={`Acciones para ${document.name}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        {document.hasText && (
                          <DropdownMenuItem
                            onSelect={() => setViewingText(document)}
                          >
                            <Eye className="size-4" />
                            Ver texto extraído
                          </DropdownMenuItem>
                        )}
                        {canManage && (
                          <>
                            {(document.status === "FAILED" ||
                              document.status === "READY" ||
                              document.status === "UPLOADED") && (
                              <DropdownMenuItem
                                onSelect={() => handleRetry(document)}
                              >
                                <RefreshCw className="size-4" />
                                {document.status === "FAILED"
                                  ? "Reintentar"
                                  : "Reprocesar"}
                              </DropdownMenuItem>
                            )}
                            {(document.status === "READY" ||
                              document.status === "DISABLED") && (
                              <DropdownMenuItem
                                onSelect={() => handleToggle(document)}
                              >
                                {document.enabled ? "Desactivar" : "Activar"}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onSelect={() =>
                                setRenaming({
                                  id: document.id,
                                  name: document.name,
                                  category: document.category,
                                })
                              }
                            >
                              <Pencil className="size-4" />
                              Renombrar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                setRecategorizing({
                                  id: document.id,
                                  name: document.name,
                                  category: document.category,
                                })
                              }
                            >
                              <Tag className="size-4" />
                              Cambiar categoría
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => startReplace(document.id)}
                            >
                              <Repeat className="size-4" />
                              Reemplazar archivo
                            </DropdownMenuItem>
                          </>
                        )}
                        {canDelete && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setDeleting(document)}
                            >
                              <Trash2 className="size-4" />
                              Eliminar
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Input oculto para reemplazo */}
      <input
        ref={replaceInputRef}
        type="file"
        accept=".pdf,.docx,.txt"
        className="sr-only"
        onChange={onReplaceFileSelected}
      />

      {/* Diálogos */}
      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        categories={categories}
        initialFile={droppedFile}
      />
      <RenameDocumentDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        document={renaming}
      />
      <CategoryDocumentDialog
        open={recategorizing !== null}
        onOpenChange={(open) => !open && setRecategorizing(null)}
        document={recategorizing}
        categories={categories}
      />
      <DocumentTextDialog
        open={viewingText !== null}
        onOpenChange={(open) => !open && setViewingText(null)}
        documentId={viewingText?.id ?? null}
        documentName={viewingText?.name ?? ""}
      />
      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Eliminar documento"
        description={
          deleting
            ? `Vas a eliminar “${deleting.name}” y su contenido indexado de forma permanente. Esta acción no se puede deshacer.`
            : ""
        }
        pending={isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
