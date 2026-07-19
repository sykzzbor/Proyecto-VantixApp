"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 1_000_000;

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function ProfileAvatarForm({
  name,
  image,
  hasGoogleImage,
}: {
  name: string;
  image: string | null;
  hasGoogleImage: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(image);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function chooseFile(nextFile: File | undefined) {
    if (!nextFile) return;
    if (!ACCEPTED_TYPES.has(nextFile.type)) {
      toast.error("Usá una imagen JPG, PNG o WEBP.");
      return;
    }
    if (nextFile.size > MAX_BYTES) {
      toast.error("La imagen debe pesar como máximo 1 MB.");
      return;
    }
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    setFile(nextFile);
    setPreview(URL.createObjectURL(nextFile));
  }

  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok) throw new Error(payload.message ?? "No se pudo guardar la foto.");
      toast.success("Foto de perfil actualizada.");
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la foto.");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        restoredGoogleImage?: boolean;
        image?: string | null;
      };
      if (!response.ok) throw new Error(payload.message ?? "No se pudo actualizar la foto.");
      toast.success(
        payload.restoredGoogleImage
          ? "Volvés a usar tu foto de Google."
          : "Se quitó la foto personalizada."
      );
      setFile(null);
      setPreview(payload.image ?? null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar la foto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <Avatar className="size-24 border border-border bg-muted">
        {preview && <AvatarImage src={preview} alt={`Foto de ${name}`} />}
        <AvatarFallback className="text-2xl font-semibold text-primary">
          {initials(name) || "U"}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <Label htmlFor="profile-avatar">Foto de perfil</Label>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            JPG, PNG o WEBP de hasta 1 MB. Si ingresaste con Google, usamos su foto automáticamente.
          </p>
        </div>
        <Input
          ref={inputRef}
          id="profile-avatar"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={!file || busy} onClick={upload}>
            <ImageUp className="size-4" aria-hidden />
            {busy ? "Guardando…" : "Guardar foto"}
          </Button>
          {(image || hasGoogleImage) && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={restore}>
              <RotateCcw className="size-4" aria-hidden />
              {hasGoogleImage ? "Usar foto de Google" : "Quitar foto"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
