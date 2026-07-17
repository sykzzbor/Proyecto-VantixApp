import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  AppointmentAvailabilityError,
  checkAppointmentAvailability,
  type AppointmentAvailabilitySlot,
} from "@/server/appointments/availability";
import {
  AppointmentError,
  cancelAppointment,
  createAppointment,
  getAppointmentReadiness,
  rescheduleAppointment,
  type AppointmentView,
} from "@/server/appointments/service";
import type { AgentToolContext } from "@/server/agent/tools";

/**
 * Herramientas de turnos para el agente (Claude). El agente NUNCA recibe
 * tokens, IDs internos, calendarId ni googleEventId: solo fechas y horarios
 * legibles. organizationId/conversationId salen SIEMPRE del contexto del
 * servidor; los turnos operables se limitan a los de esta conversación o su
 * cliente.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_SUGGESTED_SLOTS = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

const NOT_READY_MESSAGE =
  "La agenda de turnos no está disponible en este momento. Ofrecé derivar la consulta a una persona del equipo.";
const CONFIRMATION_REQUIRED =
  "Todavía no confirmes: pedile al cliente que confirme explícitamente antes de ejecutar esta acción.";

const dateSchema = z
  .string()
  .trim()
  .regex(DATE_PATTERN)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });
const timeSchema = z.string().trim().regex(TIME_PATTERN);
const safeText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !/(?:[<>]|\$\{|javascript\s*:)/i.test(value));
const normalizePhone = (value: string) => value.replace(/[\s()-]/g, "");
const isSafePhone = (value: string) => value === "" || /^\+[1-9]\d{7,14}$/.test(value);
const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .transform(normalizePhone)
  .refine(isSafePhone);

const availabilityArgs = z
  .object({
    date: dateSchema,
    days: z.number().int().min(1).max(7).nullish(),
  })
  .strict();

const createArgs = z
  .object({
    customer_name: safeText(2, 120),
    date: dateSchema,
    time: timeSchema,
    phone: phoneSchema.nullish(),
    notes: safeText(0, 500).nullish(),
    customer_confirmed: z.boolean(),
  })
  .strict();

const rescheduleArgs = z
  .object({
    current_date: dateSchema,
    current_time: timeSchema.nullish(),
    new_date: dateSchema,
    new_time: timeSchema,
    customer_confirmed: z.boolean(),
  })
  .strict();

const cancelArgs = z
  .object({
    date: dateSchema,
    time: timeSchema.nullish(),
    reason: safeText(0, 240).nullish(),
    customer_confirmed: z.boolean(),
  })
  .strict();

/** Sanitiza cualquier valor para usarlo dentro de una clave de idempotencia. */
function keyPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40);
}

/** Fecha/hora local legible a partir de un instante y su zona horaria. */
function formatLocal(instantIso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      timeZone,
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(instantIso));
  } catch {
    return instantIso;
  }
}

/** Partes locales YYYY-MM-DD y HH:MM de un instante en una zona horaria. */
function localParts(date: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

function safeErrorPayload(error: unknown): { error: string } {
  if (
    error instanceof AppointmentError ||
    error instanceof AppointmentAvailabilityError
  ) {
    // Mensajes ya seguros y humanos; sin códigos ni detalles internos.
    return { error: error.message };
  }
  return {
    error:
      "No se pudo completar la operación de agenda. Ofrecé derivar a una persona del equipo.",
  };
}

type CandidateAppointment = {
  id: string;
  startAt: Date;
  timezone: string;
  customerName: string;
  status: string;
};

type ConversationCustomer = {
  customerId: string | null;
  phone: string | null;
};

export type AppointmentToolDependencies = {
  readiness: (organizationId: string) => ReturnType<typeof getAppointmentReadiness>;
  availability: typeof checkAppointmentAvailability;
  create: typeof createAppointment;
  reschedule: typeof rescheduleAppointment;
  cancel: typeof cancelAppointment;
  /** Cliente real de la conversación, siempre acotado a la organización. */
  getConversationCustomer: (ctx: AgentToolContext) => Promise<ConversationCustomer | null>;
  /** Confirma que el mensaje entrante que disparó la tool expresa consentimiento. */
  confirmedByCustomer: (ctx: AgentToolContext) => Promise<boolean>;
  /** Turnos futuros operables vinculados a la conversación o a su cliente. */
  findCandidates: (ctx: AgentToolContext, now: Date) => Promise<CandidateAppointment[]>;
  now: () => Date;
};

async function defaultGetConversationCustomer(
  ctx: AgentToolContext
): Promise<ConversationCustomer | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: ctx.conversationId, organizationId: ctx.organizationId },
    select: { customerId: true, customer: { select: { phone: true } } },
  });
  if (!conversation) return null;
  const phone = conversation.customer?.phone
    ? normalizePhone(conversation.customer.phone)
    : "";
  return {
    customerId: conversation.customerId,
    phone: isSafePhone(phone) && phone ? phone : null,
  };
}

function normalizeConfirmation(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function isExplicitConfirmation(value: string): boolean {
  const normalized = normalizeConfirmation(value);
  if (["si", "confirmo", "confirmado", "dale", "ok", "okay", "de acuerdo"].includes(normalized)) {
    return true;
  }
  return /^(?:si[, ]+(?:por favor|dale|confirmo|quiero|hagamoslo)|(?:confirmo|reserva(?:lo|me)?|cancela(?:lo|me)?|reprograma(?:lo|me)?|cambialo|hacelo)\b)/.test(
    normalized
  );
}

async function defaultConfirmedByCustomer(ctx: AgentToolContext): Promise<boolean> {
  if (!ctx.sourceMessageId) return false;
  const message = await prisma.message.findFirst({
    where: {
      id: ctx.sourceMessageId,
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      senderType: "CUSTOMER",
    },
    select: { content: true },
  });
  return message ? isExplicitConfirmation(message.content) : false;
}

async function defaultFindCandidates(
  ctx: AgentToolContext,
  now: Date
): Promise<CandidateAppointment[]> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: ctx.conversationId, organizationId: ctx.organizationId },
    select: { customerId: true },
  });
  return prisma.appointment.findMany({
    where: {
      organizationId: ctx.organizationId,
      status: { in: ["CONFIRMED", "RESCHEDULED"] },
      startAt: { gte: now },
      OR: [
        { conversationId: ctx.conversationId },
        ...(conversation?.customerId
          ? [{ customerId: conversation.customerId }]
          : []),
      ],
    },
    orderBy: { startAt: "asc" },
    take: 10,
    select: {
      id: true,
      startAt: true,
      timezone: true,
      customerName: true,
      status: true,
    },
  });
}

export const defaultAppointmentToolDependencies: AppointmentToolDependencies = {
  readiness: (organizationId) => getAppointmentReadiness(organizationId),
  availability: checkAppointmentAvailability,
  create: createAppointment,
  reschedule: rescheduleAppointment,
  cancel: cancelAppointment,
  getConversationCustomer: defaultGetConversationCustomer,
  confirmedByCustomer: defaultConfirmedByCustomer,
  findCandidates: defaultFindCandidates,
  now: () => new Date(),
};

/**
 * Busca slots reales para un rango de fechas locales. La ventana UTC se abre
 * un día a cada lado y después se filtra por la fecha local devuelta, para no
 * depender de la zona horaria en el borde del día.
 */
async function findSlots(
  deps: AppointmentToolDependencies,
  organizationId: string,
  fromDate: string,
  daysCount: number
): Promise<{ timeZone: string; durationMinutes: number; slots: AppointmentAvailabilitySlot[] }> {
  const fromUtc = new Date(`${fromDate}T00:00:00.000Z`);
  const from = new Date(fromUtc.getTime() - DAY_MS);
  const to = new Date(fromUtc.getTime() + (daysCount + 1) * DAY_MS);
  const result = await deps.availability({
    organizationId,
    request: { from: from.toISOString(), to: to.toISOString() },
    now: deps.now(),
  });
  const lastDate = new Date(fromUtc.getTime() + (daysCount - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const slots = result.slots.filter((slot) => {
    const slotDate = slot.startLocal.slice(0, 10);
    return slotDate >= fromDate && slotDate <= lastDate;
  });
  return {
    timeZone: result.timeZone,
    durationMinutes: result.durationMinutes,
    slots,
  };
}

async function hasExplicitConfirmation(
  deps: AppointmentToolDependencies,
  ctx: AgentToolContext
): Promise<boolean> {
  try {
    return await deps.confirmedByCustomer(ctx);
  } catch {
    return false;
  }
}

function describeSlots(slots: AppointmentAvailabilitySlot[]): string[] {
  return slots
    .slice(0, MAX_SUGGESTED_SLOTS)
    .map((slot) => `${slot.startLocal.slice(0, 10)} ${slot.startLocal.slice(11, 16)} h`);
}

function appointmentSummary(view: AppointmentView): Record<string, unknown> {
  return {
    estado:
      view.status === "CANCELLED"
        ? "cancelado"
        : view.status === "RESCHEDULED"
          ? "reprogramado"
          : "confirmado",
    cliente: view.customerName,
    fecha_y_hora: formatLocal(view.startAt, view.timezone),
  };
}

/** Filtra candidatos por fecha (y hora si vino) locales. */
function matchCandidates(
  candidates: CandidateAppointment[],
  date: string,
  time: string | null | undefined
): CandidateAppointment[] {
  return candidates.filter((candidate) => {
    const local = localParts(candidate.startAt, candidate.timezone);
    if (local.date !== date) return false;
    return !time || local.time === time;
  });
}

function describeCandidates(candidates: CandidateAppointment[]): string[] {
  return candidates.map((candidate) => {
    const local = localParts(candidate.startAt, candidate.timezone);
    return `${local.date} ${local.time} h (${candidate.customerName})`;
  });
}

async function requireReadiness(
  deps: AppointmentToolDependencies,
  organizationId: string
): Promise<{ ok: true } | { ok: false; payload: { error: string } }> {
  const readiness = await deps.readiness(organizationId);
  if (readiness.ready) return { ok: true };
  return { ok: false, payload: { error: NOT_READY_MESSAGE } };
}

// ============================================================
// Ejecutores (payload = lo único que ve el modelo)
// ============================================================

export async function runCheckAvailability(
  ctx: AgentToolContext,
  rawArgs: unknown,
  deps: AppointmentToolDependencies = defaultAppointmentToolDependencies
): Promise<{ payload: unknown; resultCount: number }> {
  const parsed = availabilityArgs.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      payload: {
        error:
          "Necesito una fecha concreta (AAAA-MM-DD). Pedile al cliente que aclare el día.",
      },
      resultCount: 0,
    };
  }
  const ready = await requireReadiness(deps, ctx.organizationId);
  if (!ready.ok) return { payload: ready.payload, resultCount: 0 };

  try {
    const { timeZone, durationMinutes, slots } = await findSlots(
      deps,
      ctx.organizationId,
      parsed.data.date,
      parsed.data.days ?? 1
    );
    if (slots.length === 0) {
      return {
        payload: {
          horarios_disponibles: [],
          nota: "No hay horarios libres en esas fechas. Ofrecé consultar otro día.",
        },
        resultCount: 0,
      };
    }
    return {
      payload: {
        zona_horaria: timeZone,
        duracion_minutos: durationMinutes,
        horarios_disponibles: describeSlots(slots),
        nota: "Ofrecé solo estos horarios. No inventes otros.",
      },
      resultCount: Math.min(slots.length, MAX_SUGGESTED_SLOTS),
    };
  } catch (error) {
    return { payload: safeErrorPayload(error), resultCount: 0 };
  }
}

export async function runCreateAppointment(
  ctx: AgentToolContext,
  rawArgs: unknown,
  deps: AppointmentToolDependencies = defaultAppointmentToolDependencies
): Promise<{ payload: unknown; resultCount: number }> {
  const parsed = createArgs.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      payload: {
        error:
          "Para reservar necesito nombre del cliente, fecha (AAAA-MM-DD) y hora (HH:MM) claros. Pedí lo que falte.",
      },
      resultCount: 0,
    };
  }
  if (!parsed.data.customer_confirmed) {
    return { payload: { error: CONFIRMATION_REQUIRED }, resultCount: 0 };
  }
  if (!(await hasExplicitConfirmation(deps, ctx))) {
    return { payload: { error: CONFIRMATION_REQUIRED }, resultCount: 0 };
  }
  const ready = await requireReadiness(deps, ctx.organizationId);
  if (!ready.ok) return { payload: ready.payload, resultCount: 0 };

  try {
    // Re-verificación real: el horario pedido debe seguir libre.
    const { slots } = await findSlots(deps, ctx.organizationId, parsed.data.date, 1);
    const requested = slots.find(
      (slot) => slot.startLocal.slice(11, 16) === parsed.data.time
    );
    if (!requested) {
      return {
        payload: {
          error: "Ese horario ya no está disponible.",
          alternativas: describeSlots(slots).slice(0, 3),
        },
        resultCount: 0,
      };
    }

    const conversation = await deps.getConversationCustomer(ctx);
    if (!conversation) {
      return {
        payload: { error: "No pude validar la conversación para reservar el turno." },
        resultCount: 0,
      };
    }
    const phone = parsed.data.phone?.trim() || conversation.phone || "";

    const view = await deps.create({
      organizationId: ctx.organizationId,
      createdByUserId: null,
      source: "AI",
      customerId: conversation.customerId,
      conversationId: ctx.conversationId,
      startAt: requested.startUtc,
      customerName: parsed.data.customer_name,
      customerPhone: phone,
      notes: parsed.data.notes?.trim() || "",
      // El mensaje confirmado vuelve estable un retry sin bloquear reservas futuras.
      idempotencyKey: `ai-${keyPart(ctx.conversationId)}-${keyPart(requested.startUtc)}-${keyPart(ctx.sourceMessageId ?? "sin-origen")}`,
    });
    return {
      payload: {
        ok: true,
        turno: appointmentSummary(view),
        nota: "Confirmale al cliente la fecha y la hora exactas.",
      },
      resultCount: 1,
    };
  } catch (error) {
    return { payload: safeErrorPayload(error), resultCount: 0 };
  }
}

export async function runRescheduleAppointment(
  ctx: AgentToolContext,
  rawArgs: unknown,
  deps: AppointmentToolDependencies = defaultAppointmentToolDependencies
): Promise<{ payload: unknown; resultCount: number }> {
  const parsed = rescheduleArgs.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      payload: {
        error:
          "Para reprogramar necesito la fecha actual del turno y la nueva fecha y hora (AAAA-MM-DD y HH:MM).",
      },
      resultCount: 0,
    };
  }
  if (!parsed.data.customer_confirmed) {
    return { payload: { error: CONFIRMATION_REQUIRED }, resultCount: 0 };
  }
  if (!(await hasExplicitConfirmation(deps, ctx))) {
    return { payload: { error: CONFIRMATION_REQUIRED }, resultCount: 0 };
  }
  const ready = await requireReadiness(deps, ctx.organizationId);
  if (!ready.ok) return { payload: ready.payload, resultCount: 0 };

  try {
    const now = deps.now();
    const candidates = await deps.findCandidates(ctx, now);
    const matches = matchCandidates(
      candidates,
      parsed.data.current_date,
      parsed.data.current_time
    );
    if (matches.length === 0) {
      return {
        payload: {
          error: "No encuentro un turno de este cliente en esa fecha.",
          turnos_del_cliente: describeCandidates(candidates),
        },
        resultCount: 0,
      };
    }
    if (matches.length > 1) {
      return {
        payload: {
          error: "Hay más de un turno posible. Preguntale cuál quiere cambiar.",
          turnos_posibles: describeCandidates(matches),
        },
        resultCount: 0,
      };
    }

    const { slots } = await findSlots(deps, ctx.organizationId, parsed.data.new_date, 1);
    const requested = slots.find(
      (slot) => slot.startLocal.slice(11, 16) === parsed.data.new_time
    );
    if (!requested) {
      return {
        payload: {
          error: "El nuevo horario no está disponible.",
          alternativas: describeSlots(slots).slice(0, 3),
        },
        resultCount: 0,
      };
    }

    const view = await deps.reschedule({
      organizationId: ctx.organizationId,
      appointmentId: matches[0]!.id,
      userId: null,
      startAt: requested.startUtc,
      idempotencyKey: `ai-rs-${keyPart(matches[0]!.id)}-${keyPart(requested.startUtc)}-${keyPart(ctx.sourceMessageId ?? "sin-origen")}`,
    });
    return {
      payload: {
        ok: true,
        turno: appointmentSummary(view),
        nota: "Confirmale al cliente el nuevo horario.",
      },
      resultCount: 1,
    };
  } catch (error) {
    return { payload: safeErrorPayload(error), resultCount: 0 };
  }
}

export async function runCancelAppointment(
  ctx: AgentToolContext,
  rawArgs: unknown,
  deps: AppointmentToolDependencies = defaultAppointmentToolDependencies
): Promise<{ payload: unknown; resultCount: number }> {
  const parsed = cancelArgs.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      payload: {
        error: "Para cancelar necesito la fecha del turno (AAAA-MM-DD).",
      },
      resultCount: 0,
    };
  }
  if (!parsed.data.customer_confirmed) {
    return { payload: { error: CONFIRMATION_REQUIRED }, resultCount: 0 };
  }
  if (!(await hasExplicitConfirmation(deps, ctx))) {
    return { payload: { error: CONFIRMATION_REQUIRED }, resultCount: 0 };
  }
  const ready = await requireReadiness(deps, ctx.organizationId);
  if (!ready.ok) return { payload: ready.payload, resultCount: 0 };

  try {
    const now = deps.now();
    const candidates = await deps.findCandidates(ctx, now);
    const matches = matchCandidates(candidates, parsed.data.date, parsed.data.time);
    if (matches.length === 0) {
      return {
        payload: {
          error: "No encuentro un turno de este cliente en esa fecha.",
          turnos_del_cliente: describeCandidates(candidates),
        },
        resultCount: 0,
      };
    }
    if (matches.length > 1) {
      return {
        payload: {
          error: "Hay más de un turno en esa fecha. Preguntale cuál quiere cancelar.",
          turnos_posibles: describeCandidates(matches),
        },
        resultCount: 0,
      };
    }

    const view = await deps.cancel({
      organizationId: ctx.organizationId,
      appointmentId: matches[0]!.id,
      userId: null,
      reason: parsed.data.reason?.trim() || "",
      idempotencyKey: `ai-cx-${keyPart(matches[0]!.id)}-${keyPart(parsed.data.date)}-${keyPart(ctx.sourceMessageId ?? "sin-origen")}`,
    });
    return {
      payload: {
        ok: true,
        turno: appointmentSummary(view),
        nota: "Confirmale al cliente que el turno quedó cancelado.",
      },
      resultCount: 1,
    };
  } catch (error) {
    return { payload: safeErrorPayload(error), resultCount: 0 };
  }
}

// ============================================================
// Definiciones para el modelo (sin IDs internos en los schemas)
// ============================================================

export const APPOINTMENT_TOOL_DEFINITIONS = [
  {
    name: "check_appointment_availability",
    description:
      "Consulta horarios disponibles para turnos en una fecha concreta (no crea nada). Usala antes de ofrecer horarios. Si el cliente no dio una fecha clara, pedila antes de llamar.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "Fecha a consultar en formato AAAA-MM-DD.",
        },
        days: {
          type: ["integer", "null"],
          description: "Cantidad de días a revisar desde esa fecha (1 a 7), o null para solo ese día.",
        },
      },
      additionalProperties: false as const,
      required: ["date", "days"],
    },
  },
  {
    name: "create_appointment",
    description:
      "Reserva un turno. SOLO usala cuando el cliente ya confirmó explícitamente nombre, fecha y hora exactos. Verifica la disponibilidad de nuevo antes de crear.",
    inputSchema: {
      type: "object" as const,
      properties: {
        customer_name: { type: "string", description: "Nombre del cliente." },
        date: { type: "string", description: "Fecha AAAA-MM-DD." },
        time: { type: "string", description: "Hora local HH:MM (24 h)." },
        phone: {
          type: ["string", "null"],
          description: "Teléfono del cliente en formato internacional, o null.",
        },
        notes: {
          type: ["string", "null"],
          description: "Nota breve del pedido, o null.",
        },
        customer_confirmed: {
          type: "boolean",
          description: "true solo si el cliente confirmó explícitamente esta reserva.",
        },
      },
      additionalProperties: false as const,
      required: ["customer_name", "date", "time", "phone", "notes", "customer_confirmed"],
    },
  },
  {
    name: "reschedule_appointment",
    description:
      "Reprograma un turno existente de este cliente. Requiere confirmación explícita del cliente y la fecha actual del turno. Si hay varios turnos posibles, preguntá cuál.",
    inputSchema: {
      type: "object" as const,
      properties: {
        current_date: { type: "string", description: "Fecha actual del turno (AAAA-MM-DD)." },
        current_time: {
          type: ["string", "null"],
          description: "Hora actual del turno HH:MM, o null si no la sabés.",
        },
        new_date: { type: "string", description: "Nueva fecha AAAA-MM-DD." },
        new_time: { type: "string", description: "Nueva hora local HH:MM." },
        customer_confirmed: {
          type: "boolean",
          description: "true solo si el cliente confirmó explícitamente el cambio.",
        },
      },
      additionalProperties: false as const,
      required: ["current_date", "current_time", "new_date", "new_time", "customer_confirmed"],
    },
  },
  {
    name: "cancel_appointment",
    description:
      "Cancela un turno existente de este cliente. Requiere confirmación explícita del cliente. Si hay varios turnos en esa fecha, preguntá cuál.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "Fecha del turno a cancelar (AAAA-MM-DD)." },
        time: {
          type: ["string", "null"],
          description: "Hora del turno HH:MM, o null si no la sabés.",
        },
        reason: {
          type: ["string", "null"],
          description: "Motivo breve de la cancelación, o null.",
        },
        customer_confirmed: {
          type: "boolean",
          description: "true solo si el cliente confirmó explícitamente la cancelación.",
        },
      },
      additionalProperties: false as const,
      required: ["date", "time", "reason", "customer_confirmed"],
    },
  },
];
