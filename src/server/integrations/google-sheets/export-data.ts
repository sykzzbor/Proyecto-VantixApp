import { prisma } from "@/lib/prisma";

export const GOOGLE_SHEETS_DATASETS = [
  "clients",
  "conversations",
  "metrics",
] as const;
export type GoogleSheetsDataset = (typeof GOOGLE_SHEETS_DATASETS)[number];

export type SheetExport = {
  sheetName: "Clientes" | "Conversaciones" | "Métricas";
  values: (string | number | boolean)[][];
  dataRows: number;
};

/** Evita que texto proveniente de usuarios se interprete como fórmula. */
export function safeSheetCell(value: string | null | undefined): string {
  const normalized = (value ?? "").replaceAll("\u0000", "").slice(0, 5000);
  return /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
}

export async function buildOrganizationExports(
  organizationId: string,
  datasets: readonly GoogleSheetsDataset[]
): Promise<SheetExport[]> {
  const requested = new Set(datasets);
  const exports: SheetExport[] = [];

  if (requested.has("clients")) {
    const clients = await prisma.customer.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      take: 10_000,
      select: {
        name: true,
        phone: true,
        email: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    exports.push({
      sheetName: "Clientes",
      dataRows: clients.length,
      values: [
        ["Nombre", "Teléfono", "Email", "Notas", "Creado", "Actualizado"],
        ...clients.map((client) => [
          safeSheetCell(client.name),
          safeSheetCell(client.phone),
          safeSheetCell(client.email),
          safeSheetCell(client.notes),
          client.createdAt.toISOString(),
          client.updatedAt.toISOString(),
        ]),
      ],
    });
  }

  if (requested.has("conversations")) {
    const conversations = await prisma.conversation.findMany({
      where: { organizationId },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      take: 10_000,
      select: {
        channel: true,
        status: true,
        handlingMode: true,
        unreadCount: true,
        lastMessageAt: true,
        createdAt: true,
        customer: { select: { name: true, phone: true } },
        assignedUser: { select: { name: true, email: true } },
        _count: { select: { messages: true } },
      },
    });
    exports.push({
      sheetName: "Conversaciones",
      dataRows: conversations.length,
      values: [
        [
          "Cliente",
          "Teléfono",
          "Canal",
          "Estado",
          "Modo",
          "Responsable",
          "Mensajes",
          "Sin leer",
          "Última actividad",
          "Creada",
        ],
        ...conversations.map((conversation) => [
          safeSheetCell(conversation.customer?.name ?? "Sin identificar"),
          safeSheetCell(conversation.customer?.phone),
          safeSheetCell(conversation.channel),
          conversation.status,
          conversation.handlingMode,
          safeSheetCell(
            conversation.assignedUser?.name ?? conversation.assignedUser?.email
          ),
          conversation._count.messages,
          conversation.unreadCount,
          conversation.lastMessageAt?.toISOString() ?? "",
          conversation.createdAt.toISOString(),
        ]),
      ],
    });
  }

  if (requested.has("metrics")) {
    const [clients, conversations, messages, statusGroups, modeGroups, ai] =
      await Promise.all([
        prisma.customer.count({ where: { organizationId } }),
        prisma.conversation.count({ where: { organizationId } }),
        prisma.message.count({ where: { organizationId } }),
        prisma.conversation.groupBy({
          by: ["status"],
          where: { organizationId },
          _count: { _all: true },
        }),
        prisma.conversation.groupBy({
          by: ["handlingMode"],
          where: { organizationId },
          _count: { _all: true },
        }),
        prisma.aiUsageEvent.aggregate({
          where: { organizationId },
          _sum: { inputTokens: true, outputTokens: true },
          _count: { _all: true },
        }),
      ]);
    const values: (string | number)[][] = [
      ["Métrica", "Valor", "Actualizado"],
      ["Clientes", clients, new Date().toISOString()],
      ["Conversaciones", conversations, new Date().toISOString()],
      ["Mensajes", messages, new Date().toISOString()],
      ["Interacciones de IA", ai._count._all, new Date().toISOString()],
      ["Tokens de entrada", ai._sum.inputTokens ?? 0, new Date().toISOString()],
      ["Tokens de salida", ai._sum.outputTokens ?? 0, new Date().toISOString()],
      ...statusGroups.map((item) => [
        `Conversaciones ${item.status.toLowerCase()}`,
        item._count._all,
        new Date().toISOString(),
      ]),
      ...modeGroups.map((item) => [
        `Conversaciones en modo ${item.handlingMode}`,
        item._count._all,
        new Date().toISOString(),
      ]),
    ];
    exports.push({ sheetName: "Métricas", values, dataRows: values.length - 1 });
  }
  return exports;
}
