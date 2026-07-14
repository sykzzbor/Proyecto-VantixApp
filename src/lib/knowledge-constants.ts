/**
 * Fuente ÚNICA de las restricciones de subida del Centro de conocimiento.
 * Client-safe (sin dependencias de Node): la importan el frontend (diálogo de
 * subida), el módulo de validaciones Zod y el backend (validateUpload / rutas).
 *
 * Límite conservador de 4 MB mientras la subida pasa por Route Handlers de
 * Vercel (cuyo body de funciones serverless ronda ~4.5 MB). Para archivos
 * mayores habrá que usar subida directa a Vercel Blob (client-upload).
 */
export const MAX_UPLOAD_MB = 4;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
export const ALLOWED_UPLOAD_EXTENSIONS: readonly string[] = [
  ".pdf",
  ".docx",
  ".txt",
];
export const UPLOAD_ACCEPT = ".pdf,.docx,.txt";
export const TOO_LARGE_MESSAGE = `El archivo supera el límite de ${MAX_UPLOAD_MB} MB.`;
