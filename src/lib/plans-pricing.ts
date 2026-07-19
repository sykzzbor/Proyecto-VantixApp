export type PlansExchangeSource =
  | "DolarHoy"
  | "Configuración"
  | "Último valor válido";

export type PlansExchangeRate = {
  rate: number | null;
  updatedAt: string | null;
  source: PlansExchangeSource | null;
};

export function isValidPlansExchangeRate(value: number): boolean {
  return Number.isFinite(value) && value >= 100 && value <= 100_000;
}

export function roundArsCommercial(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.ceil(value / 1_000) * 1_000;
}

export function convertUsdToArs(usd: number, rate: number): number {
  if (!Number.isFinite(usd) || usd < 0 || !isValidPlansExchangeRate(rate)) {
    return 0;
  }
  return roundArsCommercial(usd * rate);
}
