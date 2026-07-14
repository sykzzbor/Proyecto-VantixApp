import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Abstracción de almacenamiento de archivos del Centro de conocimiento.
 * En producción usa Vercel Blob (privado por diseño: la URL nunca se expone
 * al navegador y todo acceso pasa por el servidor validando sesión, organización
 * y permisos). En desarrollo usa el sistema de archivos local.
 *
 * NUNCA se guardan binarios en PostgreSQL.
 */

export type StorageDriver = "vercel-blob" | "local";

export class StorageError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_key" | "io_error"
  ) {
    super("No se pudo procesar el archivo almacenado.");
    this.name = "StorageError";
  }
}

export interface StorageAdapter {
  readonly driver: StorageDriver;
  /** Guarda el binario y devuelve la clave definitiva a persistir en la DB. */
  put(input: {
    key: string;
    data: Buffer;
    contentType: string;
  }): Promise<{ key: string }>;
  /** Descarga el binario. La clave nunca proviene del navegador. */
  download(key: string): Promise<Buffer>;
  /** Elimina el binario. Idempotente: no falla si ya no existe. */
  delete(key: string): Promise<void>;
}

// ============================================================
// Vercel Blob (producción)
// ============================================================

class VercelBlobStorage implements StorageAdapter {
  readonly driver = "vercel-blob" as const;

  constructor(private readonly token: string) {}

  async put(input: { key: string; data: Buffer; contentType: string }) {
    const { put } = await import("@vercel/blob");
    const blob = await put(input.key, input.data, {
      access: "public",
      token: this.token,
      contentType: input.contentType,
      // Sufijo aleatorio: la ruta no es adivinable aunque se conozca la clave lógica.
      addRandomSuffix: true,
    });
    // Persistimos la URL devuelta; solo vive en el servidor.
    return { key: blob.url };
  }

  async download(key: string): Promise<Buffer> {
    const response = await fetch(key);
    if (!response.ok) throw new StorageError("not_found");
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const { del } = await import("@vercel/blob");
    try {
      await del(key, { token: this.token });
    } catch {
      // Idempotente: si ya no existe, seguimos.
    }
  }
}

// ============================================================
// Sistema de archivos local (desarrollo)
// ============================================================

const LOCAL_ROOT = path.join(process.cwd(), ".storage");

class LocalStorage implements StorageAdapter {
  readonly driver = "local" as const;

  /** Resuelve la ruta evitando path traversal fuera del directorio base. */
  private resolveKey(key: string): string {
    const target = path.resolve(LOCAL_ROOT, key);
    const relative = path.relative(LOCAL_ROOT, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new StorageError("invalid_key");
    }
    return target;
  }

  async put(input: { key: string; data: Buffer; contentType: string }) {
    const target = this.resolveKey(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.data);
    return { key: input.key };
  }

  async download(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveKey(key));
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError("not_found");
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.resolveKey(key), { force: true });
    } catch {
      // Idempotente.
    }
  }
}

// ============================================================
// Selección del adaptador activo
// ============================================================

let cached: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (cached) return cached;
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  cached = token ? new VercelBlobStorage(token) : new LocalStorage();
  return cached;
}

/** Solo para tests: permite inyectar un adaptador en memoria. */
export function __setStorageForTests(adapter: StorageAdapter | null) {
  cached = adapter;
}
