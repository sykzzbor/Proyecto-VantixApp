/**
 * Resolución de períodos para las métricas. Argentina usa UTC-3 fijo (sin DST),
 * que se toma como la zona horaria segura por defecto de la organización.
 */
export const METRICS_TIMEZONE = "America/Argentina/Buenos_Aires";
const OFFSET_MS = 3 * 60 * 60 * 1000; // UTC-3

export type MetricsPeriod = "hoy" | "7d" | "30d" | "mes" | "custom";

export type MetricsRange = {
  from: Date;
  to: Date;
  period: MetricsPeriod;
  label: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Instante UTC de la medianoche local (Argentina) para el día/mes indicado. */
function localMidnightUtc(
  now: Date,
  { dayOffset = 0, monthStart = false }: { dayOffset?: number; monthStart?: boolean } = {}
): Date {
  const local = new Date(now.getTime() - OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = monthStart ? 1 : local.getUTCDate();
  return new Date(Date.UTC(year, month, day + dayOffset) + OFFSET_MS);
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const utc = Date.UTC(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(utc)) return null;
  return new Date(utc + OFFSET_MS);
}

export function resolveMetricsRange(input: {
  period?: string;
  from?: string;
  to?: string;
}): MetricsRange {
  const now = new Date();
  const period = (input.period ?? "7d") as MetricsPeriod;

  switch (period) {
    case "hoy":
      return { from: localMidnightUtc(now), to: now, period, label: "Hoy" };
    case "30d":
      return {
        from: new Date(now.getTime() - 30 * DAY_MS),
        to: now,
        period,
        label: "Últimos 30 días",
      };
    case "mes":
      return {
        from: localMidnightUtc(now, { monthStart: true }),
        to: now,
        period,
        label: "Este mes",
      };
    case "custom": {
      const from = input.from ? parseLocalDate(input.from) : null;
      const toRaw = input.to ? parseLocalDate(input.to) : null;
      if (from && toRaw && from <= toRaw) {
        // "to" inclusivo: hasta el final del día seleccionado.
        return {
          from,
          to: new Date(toRaw.getTime() + DAY_MS),
          period,
          label: "Rango personalizado",
        };
      }
      // Rango inválido: se cae al valor por defecto.
      return {
        from: new Date(now.getTime() - 7 * DAY_MS),
        to: now,
        period: "7d",
        label: "Últimos 7 días",
      };
    }
    case "7d":
    default:
      return {
        from: new Date(now.getTime() - 7 * DAY_MS),
        to: now,
        period: "7d",
        label: "Últimos 7 días",
      };
  }
}
