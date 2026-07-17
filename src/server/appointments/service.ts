import { Prisma } from "@/generated/prisma/client";
import type { AppointmentSource, AppointmentStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type {
  AppointmentListQuery,
  CreateAppointmentRequest,
  RescheduleAppointmentRequest,
  CancelAppointmentRequest,
} from "@/lib/validations/appointments";
import {
  activeAppointmentSettingsSchema,
  appointmentSettingsSchema,
  type AppointmentSettingsInput,
} from "@/lib/validations/appointment-settings";
import { recordAudit } from "@/server/audit";
import { checkAppointmentAvailability } from "@/server/appointments/availability";
import { sanitizeAutomationMessage } from "@/server/automation/sanitization";
import { hasRequiredGoogleCalendarScopes, isGoogleCalendarConfigured } from "@/server/integrations/google-calendar/config";
import {
  GoogleApiError,
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  updateGoogleCalendarEvent,
} from "@/server/integrations/google-calendar/oauth";
import { getValidAccessToken } from "@/server/integrations/google-calendar/service";

const ACTIVE_STATUSES: AppointmentStatus[] = ["PENDING", "CONFIRMED", "RESCHEDULED"];
const DAY_MS = 24 * 60 * 60 * 1000;

export type AppointmentRecord = {
  id: string;
  organizationId: string;
  customerId: string | null;
  conversationId: string | null;
  googleEventId: string | null;
  calendarId: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  status: AppointmentStatus;
  title: string;
  customerName: string;
  customerPhone: string | null;
  notes: string | null;
  cancellationReason: string | null;
  createdByUserId: string | null;
  source: AppointmentSource;
  idempotencyKey: string;
  lastOperationKey: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type PrerequisiteSnapshot = {
  settings: {
    enabled: boolean;
    timeZone: string;
    defaultDurationMinutes: number;
    bufferMinutes: number;
    minimumNoticeMinutes: number;
    maxAdvanceDays: number;
    weeklySchedule: unknown;
    location: string | null;
    defaultEventTitle: string;
    allowRescheduling: boolean;
    allowCancellation: boolean;
  } | null;
  connection: {
    status: "CONNECTED" | "ERROR";
    selectedCalendarId: string | null;
    grantedScopes: string[];
  } | null;
};

export type AppointmentView = {
  id: string;
  customerId: string | null;
  conversationId: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  status: AppointmentStatus;
  title: string;
  customerName: string;
  customerPhone: string | null;
  notes: string | null;
  cancellationReason: string | null;
  source: AppointmentSource;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentReadiness = {
  status:
    | "GOOGLE_NOT_CONFIGURED"
    | "GOOGLE_NOT_CONNECTED"
    | "RECONNECTION_REQUIRED"
    | "CONNECTION_ERROR"
    | "CALENDAR_NOT_SELECTED"
    | "SETTINGS_INCOMPLETE"
    | "SETTINGS_DISABLED"
    | "READY";
  message: string;
  ready: boolean;
  allowRescheduling: boolean;
  allowCancellation: boolean;
  durationMinutes: number | null;
  timeZone: string | null;
};

export class AppointmentError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "conflict"
      | "slot_unavailable"
      | "scope_insufficient"
      | "connection_expired"
      | "configuration_incomplete"
      | "operation_not_allowed"
      | "operation_in_progress"
      | "invalid_reference"
      | "google_error",
    readonly safeMessage: string,
    readonly status: 404 | 409 | 422 | 502,
    readonly appointment?: AppointmentView
  ) {
    super(safeMessage);
    this.name = "AppointmentError";
  }
}

type CreatePendingInput = {
  organizationId: string;
  customerId: string | null;
  conversationId: string | null;
  calendarId: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  title: string;
  customerName: string;
  customerPhone: string | null;
  notes: string | null;
  createdByUserId: string | null;
  source: AppointmentSource;
  idempotencyKey: string;
};

export type AppointmentServiceDependencies = {
  loadPrerequisites: (organizationId: string) => Promise<PrerequisiteSnapshot>;
  validateReferences: (input: {
    organizationId: string;
    customerId: string | null;
    conversationId: string | null;
  }) => Promise<boolean>;
  checkSlot: (input: {
    organizationId: string;
    calendarId: string;
    startAt: Date;
    endAt: Date;
    excludeAppointmentId?: string;
  }) => Promise<boolean>;
  findByIdempotency: (organizationId: string, key: string) => Promise<AppointmentRecord | null>;
  createPending: (input: CreatePendingInput) => Promise<{ record: AppointmentRecord; created: boolean }>;
  findById: (organizationId: string, id: string) => Promise<AppointmentRecord | null>;
  list: (organizationId: string, query: AppointmentListQuery) => Promise<AppointmentRecord[]>;
  claimOperation: (input: {
    organizationId: string;
    id: string;
    expectedUpdatedAt: Date;
    operationKey: string;
  }) => Promise<boolean>;
  completeCreate: (input: { organizationId: string; id: string; eventId: string }) => Promise<AppointmentRecord>;
  completeReschedule: (input: {
    organizationId: string;
    id: string;
    operationKey: string;
    startAt: Date;
    endAt: Date;
  }) => Promise<AppointmentRecord>;
  completeCancel: (input: {
    organizationId: string;
    id: string;
    operationKey: string;
    reason: string | null;
  }) => Promise<AppointmentRecord>;
  fail: (input: {
    organizationId: string;
    id: string;
    operationKey?: string;
    error: string;
  }) => Promise<AppointmentRecord>;
  createRemote: (input: {
    organizationId: string;
    calendarId: string;
    startAt: Date;
    endAt: Date;
    timeZone: string;
    title: string;
    notes: string | null;
    location: string | null;
  }) => Promise<string>;
  updateRemote: (input: {
    organizationId: string;
    calendarId: string;
    eventId: string;
    startAt: Date;
    endAt: Date;
    timeZone: string;
  }) => Promise<void>;
  deleteRemote: (input: {
    organizationId: string;
    calendarId: string;
    eventId: string;
  }) => Promise<void>;
  audit: (input: {
    organizationId: string;
    userId: string | null;
    action: string;
    appointmentId: string;
    details?: Record<string, unknown>;
  }) => Promise<void>;
};

function appointmentSelect() {
  return {
    id: true,
    organizationId: true,
    customerId: true,
    conversationId: true,
    googleEventId: true,
    calendarId: true,
    startAt: true,
    endAt: true,
    timezone: true,
    status: true,
    title: true,
    customerName: true,
    customerPhone: true,
    notes: true,
    cancellationReason: true,
    createdByUserId: true,
    source: true,
    idempotencyKey: true,
    lastOperationKey: true,
    lastError: true,
    createdAt: true,
    updatedAt: true,
  } as const;
}

const defaultDependencies: AppointmentServiceDependencies = {
  loadPrerequisites: async (organizationId) => {
    const [settings, connection] = await Promise.all([
      prisma.appointmentSettings.findUnique({
        where: { organizationId },
        select: {
          enabled: true,
          timeZone: true,
          defaultDurationMinutes: true,
          bufferMinutes: true,
          minimumNoticeMinutes: true,
          maxAdvanceDays: true,
          weeklySchedule: true,
          location: true,
          defaultEventTitle: true,
          allowRescheduling: true,
          allowCancellation: true,
        },
      }),
      prisma.googleCalendarConnection.findUnique({
        where: { organizationId },
        select: { status: true, selectedCalendarId: true, grantedScopes: true },
      }),
    ]);
    return { settings, connection };
  },
  validateReferences: async ({ organizationId, customerId, conversationId }) => {
    const [customer, conversation] = await Promise.all([
      customerId
        ? prisma.customer.findFirst({ where: { id: customerId, organizationId }, select: { id: true } })
        : Promise.resolve(null),
      conversationId
        ? prisma.conversation.findFirst({
            where: { id: conversationId, organizationId },
            select: { id: true, customerId: true },
          })
        : Promise.resolve(null),
    ]);
    if (customerId && !customer) return false;
    if (conversationId && !conversation) return false;
    return !(customerId && conversation?.customerId && conversation.customerId !== customerId);
  },
  checkSlot: async ({ organizationId, calendarId, startAt, endAt, excludeAppointmentId }) => {
    const availability = await checkAppointmentAvailability({
      organizationId,
      request: { from: startAt.toISOString(), to: endAt.toISOString() },
    });
    const exact = availability.slots.some(
      (slot) => slot.startUtc === startAt.toISOString() && slot.endUtc === endAt.toISOString()
    );
    if (!exact) return false;
    const conflict = await prisma.appointment.findFirst({
      where: {
        organizationId,
        calendarId,
        id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
        status: { in: ACTIVE_STATUSES },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    });
    return !conflict;
  },
  findByIdempotency: (organizationId, key) =>
    prisma.appointment.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: key } },
      select: appointmentSelect(),
    }),
  createPending: async (input) => {
    try {
      const record = await prisma.appointment.create({ data: input, select: appointmentSelect() });
      return { record, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.appointment.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId: input.organizationId,
              idempotencyKey: input.idempotencyKey,
            },
          },
          select: appointmentSelect(),
        });
        if (existing) return { record: existing, created: false };
      }
      throw error;
    }
  },
  findById: (organizationId, id) =>
    prisma.appointment.findUnique({
      where: { organizationId_id: { organizationId, id } },
      select: appointmentSelect(),
    }),
  list: (organizationId, query) => {
    const now = new Date();
    const from = query.from ? new Date(query.from) : now;
    const to = query.to ? new Date(query.to) : new Date(now.getTime() + 180 * DAY_MS);
    return prisma.appointment.findMany({
      where: {
        organizationId,
        status: query.status,
        startAt: { gte: from, lte: to },
      },
      orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
      take: query.limit,
      select: appointmentSelect(),
    });
  },
  claimOperation: async ({ organizationId, id, expectedUpdatedAt, operationKey }) => {
    const result = await prisma.appointment.updateMany({
      where: {
        id,
        organizationId,
        updatedAt: expectedUpdatedAt,
        status: { in: ["CONFIRMED", "RESCHEDULED", "FAILED"] },
      },
      data: { status: "PENDING", lastOperationKey: operationKey, lastError: null },
    });
    return result.count === 1;
  },
  completeCreate: ({ organizationId, id, eventId }) =>
    prisma.appointment.update({
      where: { organizationId_id: { organizationId, id } },
      data: { googleEventId: eventId, status: "CONFIRMED", lastError: null },
      select: appointmentSelect(),
    }),
  completeReschedule: ({ organizationId, id, operationKey, startAt, endAt }) =>
    prisma.appointment.update({
      where: { organizationId_id: { organizationId, id } },
      data: {
        startAt,
        endAt,
        status: "RESCHEDULED",
        lastOperationKey: operationKey,
        lastError: null,
        cancellationReason: null,
      },
      select: appointmentSelect(),
    }),
  completeCancel: ({ organizationId, id, operationKey, reason }) =>
    prisma.appointment.update({
      where: { organizationId_id: { organizationId, id } },
      data: {
        status: "CANCELLED",
        lastOperationKey: operationKey,
        cancellationReason: reason,
        lastError: null,
      },
      select: appointmentSelect(),
    }),
  fail: async ({ organizationId, id, operationKey, error }) =>
    prisma.appointment.update({
      where: { organizationId_id: { organizationId, id } },
      data: {
        status: "FAILED",
        lastOperationKey: operationKey,
        lastError: error,
      },
      select: appointmentSelect(),
    }),
  createRemote: async (input) => {
    const accessToken = await getValidAccessToken(input.organizationId, undefined, {
      requireEventManagement: true,
    });
    const result = await createGoogleCalendarEvent({ accessToken, ...input });
    return result.eventId;
  },
  updateRemote: async (input) => {
    const accessToken = await getValidAccessToken(input.organizationId, undefined, {
      requireEventManagement: true,
    });
    await updateGoogleCalendarEvent({ accessToken, ...input });
  },
  deleteRemote: async (input) => {
    const accessToken = await getValidAccessToken(input.organizationId, undefined, {
      requireEventManagement: true,
    });
    await deleteGoogleCalendarEvent({ accessToken, ...input });
  },
  audit: ({ organizationId, userId, action, appointmentId, details }) =>
    recordAudit({
      organizationId,
      userId,
      action,
      entityType: "appointment",
      entityId: appointmentId,
      details,
    }),
};

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return `${phone.slice(0, 3)}••••${phone.slice(-4)}`;
}

function toView(record: AppointmentRecord, includeNotes = true): AppointmentView {
  return {
    id: record.id,
    customerId: record.customerId,
    conversationId: record.conversationId,
    startAt: record.startAt.toISOString(),
    endAt: record.endAt.toISOString(),
    timezone: record.timezone,
    status: record.status,
    title: record.title,
    customerName: record.customerName,
    customerPhone: maskPhone(record.customerPhone),
    notes: includeNotes ? record.notes : null,
    cancellationReason: record.cancellationReason,
    source: record.source,
    lastError: record.lastError,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function parseSettings(snapshot: PrerequisiteSnapshot): AppointmentSettingsInput {
  const parsed = appointmentSettingsSchema.safeParse({
    ...snapshot.settings,
    location: snapshot.settings?.location ?? "",
  });
  if (!parsed.success || !parsed.data.enabled || !activeAppointmentSettingsSchema.safeParse(parsed.data).success) {
    throw new AppointmentError(
      "configuration_incomplete",
      "Completá y activá la configuración de turnos antes de continuar.",
      409
    );
  }
  return parsed.data;
}

function requireWritablePrerequisites(snapshot: PrerequisiteSnapshot): AppointmentSettingsInput {
  const settings = parseSettings(snapshot);
  if (!snapshot.connection) {
    throw new AppointmentError("connection_expired", "Google Calendar no está conectado.", 409);
  }
  if (snapshot.connection.status !== "CONNECTED") {
    throw new AppointmentError(
      "connection_expired",
      "La conexión con Google requiere atención. Reconectá la cuenta.",
      409
    );
  }
  if (!hasRequiredGoogleCalendarScopes(snapshot.connection.grantedScopes)) {
    throw new AppointmentError(
      "scope_insufficient",
      "Reconectá Google Calendar para autorizar la gestión de turnos.",
      409
    );
  }
  if (!snapshot.connection.selectedCalendarId) {
    throw new AppointmentError(
      "configuration_incomplete",
      "Elegí un calendario antes de gestionar turnos.",
      409
    );
  }
  return settings;
}

function safeRemoteError(error: unknown): string {
  const fallback = "Google Calendar no pudo completar la operación.";
  if (!(error instanceof GoogleApiError)) return fallback;
  return sanitizeAutomationMessage(error.safeMessage, 240) ?? fallback;
}

function sameCreation(record: AppointmentRecord, input: CreatePendingInput): boolean {
  return (
    record.customerId === input.customerId &&
    record.conversationId === input.conversationId &&
    record.calendarId === input.calendarId &&
    record.startAt.getTime() === input.startAt.getTime() &&
    record.endAt.getTime() === input.endAt.getTime() &&
    record.customerName === input.customerName &&
    record.title === input.title
  );
}

function existingResult(record: AppointmentRecord): AppointmentView {
  const view = toView(record);
  if (record.status === "FAILED") {
    throw new AppointmentError(
      "google_error",
      record.lastError ?? "Google Calendar no pudo completar la operación.",
      502,
      view
    );
  }
  return view;
}

export async function createAppointment(
  input: CreateAppointmentRequest & {
    organizationId: string;
    createdByUserId: string | null;
    source?: AppointmentSource;
  },
  dependencies: AppointmentServiceDependencies = defaultDependencies
): Promise<AppointmentView> {
  const snapshot = await dependencies.loadPrerequisites(input.organizationId);
  const settings = requireWritablePrerequisites(snapshot);
  const calendarId = snapshot.connection?.selectedCalendarId as string;
  const startAt = new Date(input.startAt);
  const endAt = new Date(startAt.getTime() + settings.defaultDurationMinutes * 60_000);
  const pending: CreatePendingInput = {
    organizationId: input.organizationId,
    customerId: input.customerId ?? null,
    conversationId: input.conversationId ?? null,
    calendarId,
    startAt,
    endAt,
    timezone: settings.timeZone,
    title: input.title || settings.defaultEventTitle,
    customerName: input.customerName,
    customerPhone: input.customerPhone || null,
    notes: input.notes || null,
    createdByUserId: input.createdByUserId,
    source: input.source ?? "MANUAL",
    idempotencyKey: input.idempotencyKey,
  };

  const existing = await dependencies.findByIdempotency(input.organizationId, input.idempotencyKey);
  if (existing) {
    if (!sameCreation(existing, pending)) {
      throw new AppointmentError("conflict", "La clave de idempotencia ya fue utilizada.", 409);
    }
    return existingResult(existing);
  }
  if (!(await dependencies.validateReferences(pending))) {
    throw new AppointmentError("invalid_reference", "El cliente o la conversación no son válidos.", 422);
  }
  if (!(await dependencies.checkSlot({ organizationId: input.organizationId, calendarId, startAt, endAt }))) {
    throw new AppointmentError("slot_unavailable", "El horario ya no está disponible.", 409);
  }

  const claimed = await dependencies.createPending(pending);
  if (!claimed.created) {
    if (!sameCreation(claimed.record, pending)) {
      throw new AppointmentError("conflict", "La clave de idempotencia ya fue utilizada.", 409);
    }
    return existingResult(claimed.record);
  }

  try {
    const eventId = await dependencies.createRemote({
      organizationId: input.organizationId,
      calendarId,
      startAt,
      endAt,
      timeZone: settings.timeZone,
      title: pending.title,
      notes: pending.notes,
      location: settings.location || null,
    });
    const confirmed = await dependencies.completeCreate({
      organizationId: input.organizationId,
      id: claimed.record.id,
      eventId,
    });
    await dependencies.audit({
      organizationId: input.organizationId,
      userId: input.createdByUserId,
      action: "turnos.creado",
      appointmentId: confirmed.id,
      details: { startAt: confirmed.startAt.toISOString(), source: confirmed.source },
    });
    return toView(confirmed);
  } catch (error) {
    const safe = safeRemoteError(error);
    const failed = await dependencies.fail({
      organizationId: input.organizationId,
      id: claimed.record.id,
      error: safe,
    });
    await dependencies.audit({
      organizationId: input.organizationId,
      userId: input.createdByUserId,
      action: "turnos.creacion_fallida",
      appointmentId: failed.id,
      details: { errorCode: error instanceof GoogleApiError ? error.code : "unknown" },
    });
    throw new AppointmentError("google_error", safe, 502, toView(failed));
  }
}

export async function rescheduleAppointment(
  input: RescheduleAppointmentRequest & {
    organizationId: string;
    appointmentId: string;
    userId: string;
  },
  dependencies: AppointmentServiceDependencies = defaultDependencies
): Promise<AppointmentView> {
  const current = await dependencies.findById(input.organizationId, input.appointmentId);
  if (!current) throw new AppointmentError("not_found", "El turno no existe.", 404);
  if (current.lastOperationKey === input.idempotencyKey) {
    const requested = new Date(input.startAt).getTime();
    if (current.status === "PENDING" || current.startAt.getTime() === requested) {
      return existingResult(current);
    }
    throw new AppointmentError("conflict", "La clave de operación ya fue utilizada.", 409);
  }
  if (current.status === "CANCELLED" || current.status === "PENDING" || !current.googleEventId) {
    throw new AppointmentError("operation_not_allowed", "El turno no puede reprogramarse.", 409);
  }
  const snapshot = await dependencies.loadPrerequisites(input.organizationId);
  const settings = requireWritablePrerequisites(snapshot);
  if (!settings.allowRescheduling) {
    throw new AppointmentError("operation_not_allowed", "La reprogramación está desactivada.", 409);
  }
  const calendarId = snapshot.connection?.selectedCalendarId as string;
  if (calendarId !== current.calendarId) {
    throw new AppointmentError("conflict", "El calendario del turno ya no coincide.", 409);
  }
  const startAt = new Date(input.startAt);
  const endAt = new Date(startAt.getTime() + settings.defaultDurationMinutes * 60_000);
  if (current.startAt.getTime() === startAt.getTime() && current.endAt.getTime() === endAt.getTime()) {
    return toView(current);
  }
  if (!(await dependencies.checkSlot({
    organizationId: input.organizationId,
    calendarId,
    startAt,
    endAt,
    excludeAppointmentId: current.id,
  }))) {
    throw new AppointmentError("slot_unavailable", "El nuevo horario no está disponible.", 409);
  }
  const claimed = await dependencies.claimOperation({
    organizationId: input.organizationId,
    id: current.id,
    expectedUpdatedAt: current.updatedAt,
    operationKey: input.idempotencyKey,
  });
  if (!claimed) throw new AppointmentError("operation_in_progress", "El turno cambió. Volvé a cargar.", 409);

  try {
    await dependencies.updateRemote({
      organizationId: input.organizationId,
      calendarId,
      eventId: current.googleEventId,
      startAt,
      endAt,
      timeZone: settings.timeZone,
    });
    const updated = await dependencies.completeReschedule({
      organizationId: input.organizationId,
      id: current.id,
      operationKey: input.idempotencyKey,
      startAt,
      endAt,
    });
    await dependencies.audit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "turnos.reprogramado",
      appointmentId: updated.id,
      details: { previousStartAt: current.startAt.toISOString(), startAt: updated.startAt.toISOString() },
    });
    return toView(updated);
  } catch (error) {
    const safe = safeRemoteError(error);
    const failed = await dependencies.fail({
      organizationId: input.organizationId,
      id: current.id,
      operationKey: input.idempotencyKey,
      error: safe,
    });
    await dependencies.audit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "turnos.reprogramacion_fallida",
      appointmentId: failed.id,
      details: { errorCode: error instanceof GoogleApiError ? error.code : "unknown" },
    });
    throw new AppointmentError("google_error", safe, 502, toView(failed));
  }
}

export async function cancelAppointment(
  input: CancelAppointmentRequest & {
    organizationId: string;
    appointmentId: string;
    userId: string;
  },
  dependencies: AppointmentServiceDependencies = defaultDependencies
): Promise<AppointmentView> {
  const current = await dependencies.findById(input.organizationId, input.appointmentId);
  if (!current) throw new AppointmentError("not_found", "El turno no existe.", 404);
  if (current.status === "CANCELLED") return toView(current);
  if (current.lastOperationKey === input.idempotencyKey) return existingResult(current);
  if (current.status === "PENDING" || !current.googleEventId) {
    throw new AppointmentError("operation_not_allowed", "El turno no puede cancelarse.", 409);
  }
  const snapshot = await dependencies.loadPrerequisites(input.organizationId);
  const settings = requireWritablePrerequisites(snapshot);
  if (!settings.allowCancellation) {
    throw new AppointmentError("operation_not_allowed", "La cancelación está desactivada.", 409);
  }
  const calendarId = snapshot.connection?.selectedCalendarId as string;
  if (calendarId !== current.calendarId) {
    throw new AppointmentError("conflict", "El calendario del turno ya no coincide.", 409);
  }
  const claimed = await dependencies.claimOperation({
    organizationId: input.organizationId,
    id: current.id,
    expectedUpdatedAt: current.updatedAt,
    operationKey: input.idempotencyKey,
  });
  if (!claimed) throw new AppointmentError("operation_in_progress", "El turno cambió. Volvé a cargar.", 409);

  try {
    await dependencies.deleteRemote({
      organizationId: input.organizationId,
      calendarId,
      eventId: current.googleEventId,
    });
    const cancelled = await dependencies.completeCancel({
      organizationId: input.organizationId,
      id: current.id,
      operationKey: input.idempotencyKey,
      reason: input.reason || null,
    });
    await dependencies.audit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "turnos.cancelado",
      appointmentId: cancelled.id,
      details: { reasonProvided: Boolean(input.reason) },
    });
    return toView(cancelled);
  } catch (error) {
    const safe = safeRemoteError(error);
    const failed = await dependencies.fail({
      organizationId: input.organizationId,
      id: current.id,
      operationKey: input.idempotencyKey,
      error: safe,
    });
    await dependencies.audit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "turnos.cancelacion_fallida",
      appointmentId: failed.id,
      details: { errorCode: error instanceof GoogleApiError ? error.code : "unknown" },
    });
    throw new AppointmentError("google_error", safe, 502, toView(failed));
  }
}

export async function getAppointment(
  organizationId: string,
  id: string,
  dependencies: AppointmentServiceDependencies = defaultDependencies
): Promise<AppointmentView | null> {
  const record = await dependencies.findById(organizationId, id);
  return record ? toView(record) : null;
}

export async function listAppointments(
  organizationId: string,
  query: AppointmentListQuery,
  dependencies: AppointmentServiceDependencies = defaultDependencies
): Promise<AppointmentView[]> {
  const records = await dependencies.list(organizationId, query);
  return records.map((record) => toView(record, false));
}

export async function getAppointmentReadiness(
  organizationId: string,
  dependencies: AppointmentServiceDependencies = defaultDependencies
): Promise<AppointmentReadiness> {
  if (!isGoogleCalendarConfigured()) {
    return readiness("GOOGLE_NOT_CONFIGURED", "Google Calendar requiere configuración del servidor.");
  }
  const snapshot = await dependencies.loadPrerequisites(organizationId);
  if (!snapshot.connection) return readiness("GOOGLE_NOT_CONNECTED", "Conectá Google Calendar.");
  if (!hasRequiredGoogleCalendarScopes(snapshot.connection.grantedScopes)) {
    return readiness("RECONNECTION_REQUIRED", "Reconectá Google Calendar para habilitar turnos reales.");
  }
  if (snapshot.connection.status !== "CONNECTED") {
    return readiness("CONNECTION_ERROR", "La conexión con Google requiere atención.");
  }
  if (!snapshot.connection.selectedCalendarId) {
    return readiness("CALENDAR_NOT_SELECTED", "Elegí el calendario de trabajo.");
  }
  const parsed = appointmentSettingsSchema.safeParse({
    ...snapshot.settings,
    location: snapshot.settings?.location ?? "",
  });
  if (!parsed.success || !activeAppointmentSettingsSchema.safeParse(parsed.data).success) {
    return readiness("SETTINGS_INCOMPLETE", "Completá los días y horarios disponibles.");
  }
  const base = {
    allowRescheduling: parsed.data.allowRescheduling,
    allowCancellation: parsed.data.allowCancellation,
    durationMinutes: parsed.data.defaultDurationMinutes,
    timeZone: parsed.data.timeZone,
  };
  if (!parsed.data.enabled) {
    return { ...readiness("SETTINGS_DISABLED", "Activá la configuración de turnos."), ...base };
  }
  return { ...readiness("READY", "Google Calendar está listo para gestionar turnos."), ...base };
}

function readiness(status: AppointmentReadiness["status"], message: string): AppointmentReadiness {
  return {
    status,
    message,
    ready: status === "READY",
    allowRescheduling: false,
    allowCancellation: false,
    durationMinutes: null,
    timeZone: null,
  };
}
