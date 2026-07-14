import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Búsqueda dentro de los documentos de conocimiento de UNA organización.
 * Usa full-text search de PostgreSQL (configuración 'spanish') con ranking
 * ts_rank y un índice GIN de expresión. La organización SIEMPRE proviene de
 * la sesión validada en el servidor: nunca de la IA ni del navegador.
 *
 * Arquitectura preparada para embeddings futuros: el resto del sistema solo
 * depende de esta función; se puede reemplazar la implementación sin cambiar
 * la herramienta del agente ni la UI.
 */

export type KnowledgeSearchHit = {
  documentId: string;
  documentName: string;
  chunkIndex: number;
  content: string;
  rank: number;
};

export const KNOWLEDGE_SEARCH_MAX_LIMIT = 6;
export const KNOWLEDGE_SEARCH_DEFAULT_LIMIT = 4;
const SNIPPET_MAX_CHARS = 600;
const QUERY_MAX_CHARS = 200;

export async function searchKnowledgeChunks(params: {
  organizationId: string;
  query: string;
  category?: string | null;
  limit?: number;
}): Promise<KnowledgeSearchHit[]> {
  const query = params.query.trim().slice(0, QUERY_MAX_CHARS);
  if (!query) return [];

  const limit = Math.min(
    Math.max(Math.trunc(params.limit ?? KNOWLEDGE_SEARCH_DEFAULT_LIMIT), 1),
    KNOWLEDGE_SEARCH_MAX_LIMIT
  );
  const category = params.category?.trim() || null;

  const hits = await prisma.$queryRaw<KnowledgeSearchHit[]>(Prisma.sql`
    SELECT
      c."documentId" AS "documentId",
      d."name" AS "documentName",
      c."chunkIndex" AS "chunkIndex",
      LEFT(c."content", ${SNIPPET_MAX_CHARS}) AS "content",
      ts_rank(to_tsvector('spanish', c."content"), plainto_tsquery('spanish', ${query})) AS "rank"
    FROM "knowledge_chunks" c
    JOIN "knowledge_documents" d ON d."id" = c."documentId"
    WHERE c."organizationId" = ${params.organizationId}
      AND d."status"::text = 'READY'
      AND d."enabled" = true
      AND (${category}::text IS NULL OR d."category" = ${category})
      AND to_tsvector('spanish', c."content") @@ plainto_tsquery('spanish', ${query})
    ORDER BY "rank" DESC, c."chunkIndex" ASC
    LIMIT ${limit}
  `);

  if (hits.length > 0) return hits;

  // Respaldo por subcadena cuando el FTS no encuentra coincidencias
  // (por ejemplo, términos muy cortos o poco frecuentes).
  const likeTerm = `%${query.replace(/[\\%_]/g, "")}%`;
  return prisma.$queryRaw<KnowledgeSearchHit[]>(Prisma.sql`
    SELECT
      c."documentId" AS "documentId",
      d."name" AS "documentName",
      c."chunkIndex" AS "chunkIndex",
      LEFT(c."content", ${SNIPPET_MAX_CHARS}) AS "content",
      0::float8 AS "rank"
    FROM "knowledge_chunks" c
    JOIN "knowledge_documents" d ON d."id" = c."documentId"
    WHERE c."organizationId" = ${params.organizationId}
      AND d."status"::text = 'READY'
      AND d."enabled" = true
      AND (${category}::text IS NULL OR d."category" = ${category})
      AND c."content" ILIKE ${likeTerm}
    ORDER BY c."chunkIndex" ASC
    LIMIT ${limit}
  `);
}
