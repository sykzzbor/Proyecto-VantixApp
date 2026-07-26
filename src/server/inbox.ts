import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";

export const DEFAULT_CUSTOMER_NAME = "Cliente de prueba";

const LIST_LIMIT = 50;
const THREAD_LIMIT = 200;

export type InboxStatus = "open" | "pending" | "closed";
export type InboxMode = "ai" | "human";
export type MessageDeliveryState =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";
export type WhatsappConnectionState = "connected" | "disconnected" | "error";

const STATUS_TO_DB = {
  open: "OPEN",
  pending: "PENDING",
  closed: "CLOSED",
} as const;

const STATUS_FROM_DB = {
  OPEN: "open",
  PENDING: "pending",
  CLOSED: "closed",
} as const;

const DELIVERY_STATUS_FROM_DB = {
  PENDING: "pending",
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
} as const;

const WHATSAPP_STATUS_FROM_DB = {
  CONNECTING: "disconnected",
  CONNECTED: "connected",
  ACTION_REQUIRED: "disconnected",
  DISCONNECTED: "disconnected",
  ERROR: "error",
} as const;

export const STATUS_LABELS: Record<InboxStatus, string> = {
  open: "Abierta",
  pending: "Pendiente",
  closed: "Cerrada",
};

export type InboxFilters = {
  q?: string;
  status?: InboxStatus;
  mode?: InboxMode;
  /**
   * Id del responsable. `"unassigned"` filtra las que no tienen a nadie.
   * El id se valida contra la organización antes de usarse.
   */
  assignedTo?: string;
  /**
   * Ids de etiquetas. Se muestran las conversaciones que tengan **alguna**
   * de las elegidas, no todas: elegir dos etiquetas amplía el resultado, que
   * es lo que espera quien filtra desde una bandeja.
   */
  tagIds?: string[];
  /** `true` deja solo las conversaciones sin ninguna etiqueta. */
  untagged?: boolean;
};

export type InboxPage = {
  items: ConversationListItem[];
  /** Cursor para la página siguiente; `null` cuando no hay más. */
  nextCursor: string | null;
  hasMore: boolean;
};

// ============================================================
// Lista de conversaciones
// ============================================================

export type ConversationListItem = {
  id: string;
  customerName: string;
  customerPhone: string | null;
  lastMessagePreview: string | null;
  lastActivityLabel: string | null;
  channel: string;
  status: InboxStatus;
  handlingMode: InboxMode;
  assignedName: string | null;
  unreadCount: number;
};

/**
 * Página de conversaciones.
 *
 * Pagina por cursor sobre el id, no por `skip`: con muchos registros un
 * `OFFSET` grande obliga a PostgreSQL a recorrer y descartar todas las filas
 * anteriores, y además puede saltear o repetir conversaciones si entra un
 * mensaje nuevo entre página y página.
 *
 * `organizationId` viene siempre de la sesión y encabeza el `where`: ninguna
 * combinación de filtros puede alcanzar la bandeja de otra organización.
 */
export async function getInboxPage(
  organizationId: string,
  filters: InboxFilters,
  options?: { cursor?: string; pageSize?: number }
): Promise<InboxPage> {
  const pageSize = Math.min(Math.max(options?.pageSize ?? LIST_LIMIT, 1), 100);
  const where: Prisma.ConversationWhereInput = { organizationId };
  if (filters.status) where.status = STATUS_TO_DB[filters.status];
  if (filters.mode) where.handlingMode = filters.mode === "ai" ? "AI" : "HUMAN";
  if (filters.assignedTo) {
    where.assignedUserId =
      filters.assignedTo === "unassigned" ? null : filters.assignedTo;
  }

  // "Sin etiquetas" y una selección concreta son excluyentes: si llegan las
  // dos, manda "sin etiquetas", que es la opción más específica.
  if (filters.untagged) {
    where.tags = { none: {} };
  } else if (filters.tagIds && filters.tagIds.length > 0) {
    // `organizationId` también en la relación: aunque llegara el id de una
    // etiqueta de otra organización, no puede traer conversaciones ajenas.
    where.tags = {
      some: { tagId: { in: filters.tagIds }, organizationId },
    };
  }
  if (filters.q) {
    where.OR = [
      { customer: { name: { contains: filters.q, mode: "insensitive" } } },
      { customer: { phone: { contains: filters.q, mode: "insensitive" } } },
      {
        messages: {
          some: { content: { contains: filters.q, mode: "insensitive" } },
        },
      },
    ];
  }

  // Se pide uno de más para saber si hay página siguiente sin contar el total.
  const rows = await prisma.conversation.findMany({
    where,
    orderBy: [
      { lastMessageAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" },
    ],
    take: pageSize + 1,
    ...(options?.cursor
      ? { cursor: { id: options.cursor }, skip: 1 }
      : {}),
    include: {
      customer: { select: { name: true, phone: true } },
      assignedUser: { select: { name: true } },
      messages: {
        where: { senderType: { not: "SYSTEM" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, senderType: true },
      },
    },
  });

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  const items: ConversationListItem[] = page.map((conversation) => {
    const lastMessage = conversation.messages[0] ?? null;
    return {
      id: conversation.id,
      customerName: conversation.customer?.name ?? DEFAULT_CUSTOMER_NAME,
      customerPhone: conversation.customer?.phone ?? null,
      lastMessagePreview: lastMessage?.content ?? null,
      lastActivityLabel: conversation.lastMessageAt
        ? formatDateTime(conversation.lastMessageAt)
        : formatDateTime(conversation.createdAt),
      channel: conversation.channel,
      status: STATUS_FROM_DB[conversation.status],
      handlingMode: conversation.handlingMode === "AI" ? "ai" : "human",
      assignedName: conversation.assignedUser?.name ?? null,
      unreadCount: conversation.unreadCount,
    };
  });

  return {
    items,
    hasMore,
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  };
}

/**
 * Primera página de conversaciones. Se conserva para las pantallas que no
 * paginan; internamente usa `getInboxPage`.
 */
export async function getInboxConversations(
  organizationId: string,
  filters: InboxFilters
): Promise<ConversationListItem[]> {
  const page = await getInboxPage(organizationId, filters);
  return page.items;
}

/**
 * Marca los mensajes del cliente como leídos al abrir la conversación.
 * Ambas escrituras quedan acotadas a la organización.
 */
export async function markThreadRead(
  organizationId: string,
  conversationId: string
) {
  await prisma.$transaction([
    prisma.conversation.updateMany({
      where: { id: conversationId, organizationId, unreadCount: { gt: 0 } },
      data: { unreadCount: 0 },
    }),
    prisma.message.updateMany({
      where: {
        conversationId,
        organizationId,
        senderType: "CUSTOMER",
        readAt: null,
      },
      data: { readAt: new Date() },
    }),
  ]);
}

// ============================================================
// Detalle de una conversación
// ============================================================

export type ThreadMessage = {
  id: string;
  senderType: "customer" | "ai" | "human" | "system";
  senderName: string;
  content: string;
  timeLabel: string;
  dateLabel: string;
  deliveryStatus: MessageDeliveryState | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  messageType:
    | "text"
    | "audio"
    | "image"
    | "document"
    | "video"
    | "sticker"
    | "location"
    | "unknown";
  mediaFilename: string | null;
};

export type ConversationDetail = {
  id: string;
  channel: string;
  status: InboxStatus;
  handlingMode: InboxMode;
  whatsappIntegrationStatus: WhatsappConnectionState | null;
  assigned: { userId: string; name: string } | null;
  humanTakeoverAtLabel: string | null;
  createdAtLabel: string;
  lastActivityLabel: string | null;
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    notes: string | null;
  } | null;
  messages: ThreadMessage[];
  /** Turnos vinculados a la conversación o al cliente (solo datos visibles). */
  appointments: {
    whenLabel: string;
    statusLabel:
      | "Confirmado"
      | "Reprogramado"
      | "Cancelado"
      | "Pendiente"
      | "Con error";
    upcoming: boolean;
  }[];
};

const APPOINTMENT_STATUS_LABEL = {
  CONFIRMED: "Confirmado",
  RESCHEDULED: "Reprogramado",
  CANCELLED: "Cancelado",
  PENDING: "Pendiente",
  FAILED: "Con error",
} as const;

function messagePresentation(metadata: Prisma.JsonValue): {
  messageType: ThreadMessage["messageType"];
  mediaFilename: string | null;
} {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { messageType: "text", mediaFilename: null };
  }
  const record = metadata as Prisma.JsonObject;
  const supported = new Set<ThreadMessage["messageType"]>([
    "text",
    "audio",
    "image",
    "document",
    "video",
    "sticker",
    "location",
  ]);
  const rawType = typeof record.messageType === "string" ? record.messageType : "text";
  const messageType = supported.has(rawType as ThreadMessage["messageType"])
    ? (rawType as ThreadMessage["messageType"])
    : "unknown";
  const media =
    record.media && typeof record.media === "object" && !Array.isArray(record.media)
      ? (record.media as Prisma.JsonObject)
      : null;
  const filename = media && typeof media.filename === "string" ? media.filename.trim() : "";
  return {
    messageType,
    mediaFilename: filename ? filename.slice(0, 180) : null,
  };
}

function formatAppointmentWhen(startAt: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(startAt);
  } catch {
    return formatDateTime(startAt);
  }
}

export async function getConversationDetail(
  organizationId: string,
  conversationId: string
): Promise<ConversationDetail | null> {
  // Siempre filtrado por la organización de la sesión.
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId },
    include: {
      customer: true,
      assignedUser: { select: { id: true, name: true } },
      whatsappIntegration: { select: { status: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: THREAD_LIMIT,
        include: { senderUser: { select: { name: true } } },
      },
    },
  });
  if (!conversation) return null;

  const [settings, appointmentRecords] = await Promise.all([
    prisma.agentSettings.findUnique({
      where: { organizationId },
      select: { assistantName: true },
    }),
    prisma.appointment.findMany({
      where: {
        organizationId,
        OR: [
          { conversationId },
          ...(conversation.customerId
            ? [{ customerId: conversation.customerId }]
            : []),
        ],
      },
      orderBy: { startAt: "desc" },
      take: 4,
      select: { startAt: true, timezone: true, status: true },
    }),
  ]);
  const now = Date.now();
  const appointments = appointmentRecords
    .map((appointment) => ({
      whenLabel: formatAppointmentWhen(appointment.startAt, appointment.timezone),
      statusLabel: APPOINTMENT_STATUS_LABEL[appointment.status],
      upcoming:
        appointment.startAt.getTime() >= now &&
        appointment.status !== "CANCELLED",
      startMs: appointment.startAt.getTime(),
    }))
    .sort((a, b) => Number(b.upcoming) - Number(a.upcoming) || a.startMs - b.startMs)
    .map(({ whenLabel, statusLabel, upcoming }) => ({
      whenLabel,
      statusLabel,
      upcoming,
    }));
  const aiName = settings?.assistantName ?? "Asistente";
  const customerName = conversation.customer?.name ?? DEFAULT_CUSTOMER_NAME;

  const messages = [...conversation.messages].reverse().map((message) => {
    const presentation = messagePresentation(message.metadata);
    return {
      id: message.id,
      senderType:
        message.senderType === "CUSTOMER"
          ? ("customer" as const)
          : message.senderType === "AI"
            ? ("ai" as const)
            : message.senderType === "HUMAN"
              ? ("human" as const)
              : ("system" as const),
      senderName:
        message.senderType === "CUSTOMER"
          ? customerName
          : message.senderType === "AI"
            ? aiName
            : message.senderType === "HUMAN"
              ? (message.senderUser?.name ?? "Equipo")
              : "Sistema",
      content: message.content,
      timeLabel: formatTime(message.createdAt),
      dateLabel: formatDate(message.createdAt),
      deliveryStatus: message.deliveryStatus
        ? DELIVERY_STATUS_FROM_DB[message.deliveryStatus]
        : null,
      errorCode: message.errorCode,
      errorMessage: message.errorMessage,
      retryable:
        conversation.channel === "whatsapp" &&
        message.deliveryStatus === "FAILED" &&
        (message.senderType === "HUMAN" || message.senderType === "AI"),
      ...presentation,
    };
  });

  return {
    id: conversation.id,
    channel: conversation.channel,
    status: STATUS_FROM_DB[conversation.status],
    handlingMode: conversation.handlingMode === "AI" ? "ai" : "human",
    whatsappIntegrationStatus: conversation.whatsappIntegration
      ? WHATSAPP_STATUS_FROM_DB[conversation.whatsappIntegration.status]
      : null,
    assigned: conversation.assignedUser
      ? { userId: conversation.assignedUser.id, name: conversation.assignedUser.name }
      : null,
    humanTakeoverAtLabel: conversation.humanTakeoverAt
      ? formatDateTime(conversation.humanTakeoverAt)
      : null,
    createdAtLabel: formatDate(conversation.createdAt),
    lastActivityLabel: conversation.lastMessageAt
      ? formatDateTime(conversation.lastMessageAt)
      : null,
    customer: conversation.customer
      ? {
          id: conversation.customer.id,
          name: conversation.customer.name,
          phone: conversation.customer.phone,
          email: conversation.customer.email,
          notes: conversation.customer.notes,
        }
      : null,
    messages,
    appointments,
  };
}
