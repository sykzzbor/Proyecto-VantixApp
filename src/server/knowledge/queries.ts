import { Prisma } from "@/generated/prisma/client";
import type { KnowledgeDocumentStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatFileSize } from "@/lib/format";
import { FORMAT_LABEL, resolveKnowledgeFormat } from "@/server/knowledge/files";

export const KNOWLEDGE_STATUSES: KnowledgeDocumentStatus[] = [
  "UPLOADED",
  "PROCESSING",
  "READY",
  "FAILED",
  "DISABLED",
];

export type KnowledgeDocumentRow = {
  id: string;
  name: string;
  originalFilename: string;
  formatLabel: string;
  sizeLabel: string;
  category: string | null;
  status: KnowledgeDocumentStatus;
  enabled: boolean;
  chunkCount: number;
  createdAtLabel: string;
  processedAtLabel: string | null;
  uploadedByName: string | null;
  availableForAgent: boolean;
  processingError: string | null;
  hasText: boolean;
};

export type KnowledgeFilters = {
  q?: string;
  status?: string;
  category?: string;
};

function isStatus(value: string | undefined): value is KnowledgeDocumentStatus {
  return Boolean(value) && (KNOWLEDGE_STATUSES as string[]).includes(value!);
}

export async function listKnowledgeDocuments(
  organizationId: string,
  filters: KnowledgeFilters = {}
): Promise<KnowledgeDocumentRow[]> {
  const where: Prisma.KnowledgeDocumentWhereInput = { organizationId };

  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { originalFilename: { contains: q, mode: "insensitive" } },
    ];
  }
  if (isStatus(filters.status)) where.status = filters.status;
  const category = filters.category?.trim();
  if (category) where.category = category;

  const documents = await prisma.knowledgeDocument.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { name: true } } },
  });

  return documents.map((document) => {
    const format = resolveKnowledgeFormat(
      document.mimeType,
      document.originalFilename
    );
    return {
      id: document.id,
      name: document.name,
      originalFilename: document.originalFilename,
      formatLabel: FORMAT_LABEL[format],
      sizeLabel: formatFileSize(document.fileSize),
      category: document.category,
      status: document.status,
      enabled: document.enabled,
      chunkCount: document.chunkCount,
      createdAtLabel: formatDateTime(document.createdAt),
      processedAtLabel: document.processedAt
        ? formatDateTime(document.processedAt)
        : null,
      uploadedByName: document.uploadedBy?.name ?? null,
      availableForAgent: document.status === "READY" && document.enabled,
      processingError: document.processingError,
      hasText: document.status === "READY" || document.status === "DISABLED",
    };
  });
}

export async function listKnowledgeCategories(
  organizationId: string
): Promise<string[]> {
  const rows = await prisma.knowledgeDocument.findMany({
    where: { organizationId, category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows
    .map((row) => row.category)
    .filter((category): category is string => Boolean(category));
}

export type KnowledgeStats = {
  total: number;
  ready: number;
  processing: number;
  failed: number;
  availableForAgent: number;
};

export async function getKnowledgeStats(
  organizationId: string
): Promise<KnowledgeStats> {
  const grouped = await prisma.knowledgeDocument.groupBy({
    by: ["status"],
    where: { organizationId },
    _count: { _all: true },
  });

  const countByStatus = new Map<KnowledgeDocumentStatus, number>();
  let total = 0;
  for (const group of grouped) {
    countByStatus.set(group.status, group._count._all);
    total += group._count._all;
  }

  const availableForAgent = await prisma.knowledgeDocument.count({
    where: { organizationId, status: "READY", enabled: true },
  });

  return {
    total,
    ready: countByStatus.get("READY") ?? 0,
    processing:
      (countByStatus.get("PROCESSING") ?? 0) +
      (countByStatus.get("UPLOADED") ?? 0),
    failed: countByStatus.get("FAILED") ?? 0,
    availableForAgent,
  };
}

export async function getKnowledgeDocumentText(
  id: string,
  organizationId: string
): Promise<{ name: string; text: string | null; status: KnowledgeDocumentStatus } | null> {
  const document = await prisma.knowledgeDocument.findFirst({
    where: { id, organizationId },
    select: { name: true, extractedText: true, status: true },
  });
  if (!document) return null;
  return {
    name: document.name,
    text: document.extractedText,
    status: document.status,
  };
}
