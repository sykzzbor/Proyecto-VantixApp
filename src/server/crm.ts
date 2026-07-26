import { prisma } from "@/lib/prisma";

/**
 * Lecturas del CRM.
 *
 * Todas reciben el `organizationId` ya resuelto desde la sesión y lo usan en
 * el `where`: nada de lo que llegue del navegador puede alcanzar datos de
 * otra organización.
 */

export type CrmTagSummary = {
  id: string;
  name: string;
  color: string;
  /** Cuántas conversaciones y clientes la usan; sirve para avisar al borrar. */
  usageCount: number;
};

export async function getOrganizationTags(
  organizationId: string
): Promise<CrmTagSummary[]> {
  const tags = await prisma.crmTag.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      color: true,
      _count: { select: { conversations: true, customers: true } },
    },
  });

  return tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
    usageCount: tag._count.conversations + tag._count.customers,
  }));
}

export type AppliedTag = { id: string; name: string; color: string };

export async function getConversationTags(
  organizationId: string,
  conversationId: string
): Promise<AppliedTag[]> {
  const rows = await prisma.conversationTag.findMany({
    where: { organizationId, conversationId },
    select: { tag: { select: { id: true, name: true, color: true } } },
    orderBy: { tag: { name: "asc" } },
  });
  return rows.map((row) => row.tag);
}

export type ConversationNoteView = {
  id: string;
  body: string;
  authorName: string;
  authorId: string | null;
  createdAt: string;
  editedAt: string | null;
};

export async function getConversationNotes(
  organizationId: string,
  conversationId: string
): Promise<ConversationNoteView[]> {
  const notes = await prisma.conversationNote.findMany({
    where: { organizationId, conversationId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      body: true,
      authorId: true,
      createdAt: true,
      editedAt: true,
      author: { select: { name: true } },
    },
  });

  return notes.map((note) => ({
    id: note.id,
    body: note.body,
    // Si la persona se dio de baja, la nota sobrevive sin autor.
    authorName: note.author?.name ?? "Integrante dado de baja",
    authorId: note.authorId,
    createdAt: note.createdAt.toISOString(),
    editedAt: note.editedAt?.toISOString() ?? null,
  }));
}
