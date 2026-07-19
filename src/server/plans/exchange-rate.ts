import {
  isValidPlansExchangeRate,
  type PlansExchangeRate,
} from "@/lib/plans-pricing";

const DOLAR_HOY_BLUE_EMBED_URL =
  "https://dolarhoy.com/i/cotizaciones/dolar-blue";
const PROVIDER_TIMEOUT_MS = 2_500;
const PROVIDER_CACHE_MS = 30 * 60 * 1_000;
const MAX_PROVIDER_BODY_BYTES = 100_000;

type ValidExchangeRate = Required<PlansExchangeRate>;

type PlansExchangeEnv = {
  PLANS_USD_ARS_RATE?: string;
  PLANS_USD_ARS_UPDATED_AT?: string;
};

type ProviderCache = {
  freshUntil: number;
  value: ValidExchangeRate;
};

let providerCache: ProviderCache | null = null;
let lastValidProviderValue: ValidExchangeRate | null = null;
let inFlightRequest: Promise<ValidExchangeRate | null> | null = null;

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&#([0-9]+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#160;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

export function parseDolarHoyBlueSellRate(html: string): number | null {
  if (!html || html.length > MAX_PROVIDER_BODY_BYTES) return null;

  const visibleLines = decodeBasicHtmlEntities(
    html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(
        /<\/?(?:div|p|h[1-6]|li|main|section|article|tr|td|th)\b[^>]*>/gi,
        "\n"
      )
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const visibleText = visibleLines.join(" ");

  if (!/d[oó]lar\s+blue/i.test(visibleText)) return null;

  const sellLine = visibleLines.find((line) => /\bVenta\b/i.test(line));
  if (!sellLine) return null;
  const valuePattern = "([0-9]{1,6}(?:[.\\s][0-9]{3})*(?:,[0-9]{1,2})?)";
  const match =
    sellLine.match(new RegExp(`${valuePattern}\\s*(?:\\$\\s*)?Venta`, "i")) ??
    sellLine.match(new RegExp(`Venta\\s*\\$?\\s*${valuePattern}`, "i"));
  if (!match?.[1]) return null;

  const parsed = Number(match[1].replace(/[.\s]/g, "").replace(",", "."));
  return isValidPlansExchangeRate(parsed) ? parsed : null;
}

function environmentFallback(
  env: PlansExchangeEnv,
  now: number
): ValidExchangeRate | null {
  const rate = Number(env.PLANS_USD_ARS_RATE);
  if (!isValidPlansExchangeRate(rate)) return null;

  const configuredUpdatedAt = env.PLANS_USD_ARS_UPDATED_AT?.trim();
  const updatedAt =
    configuredUpdatedAt && !Number.isNaN(Date.parse(configuredUpdatedAt))
      ? new Date(configuredUpdatedAt).toISOString()
      : new Date(now).toISOString();

  return { rate, updatedAt, source: "Configuración" };
}

async function fetchProviderRate({
  fetchImpl,
  now,
  timeoutMs,
}: {
  fetchImpl: typeof fetch;
  now: number;
  timeoutMs: number;
}): Promise<ValidExchangeRate | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(DOLAR_HOY_BLUE_EMBED_URL, {
      method: "GET",
      headers: {
        Accept: "text/html;charset=UTF-8",
        "User-Agent": "VantixApp/1.0 (plans exchange reference)",
      },
      redirect: "error",
      signal: controller.signal,
      next: { revalidate: 1_800 },
    });
    if (!response.ok) return null;

    const contentLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_PROVIDER_BODY_BYTES
    ) {
      return null;
    }

    const rate = parseDolarHoyBlueSellRate(await response.text());
    if (rate === null) return null;

    return {
      rate,
      updatedAt: new Date(now).toISOString(),
      source: "DolarHoy",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getPlansExchangeRate(options?: {
  fetchImpl?: typeof fetch;
  env?: PlansExchangeEnv;
  now?: number;
  timeoutMs?: number;
}): Promise<PlansExchangeRate> {
  const now = options?.now ?? Date.now();
  const env =
    options?.env ?? (process.env as unknown as PlansExchangeEnv);

  if (providerCache && providerCache.freshUntil > now) {
    return providerCache.value;
  }

  if (!inFlightRequest) {
    inFlightRequest = fetchProviderRate({
      fetchImpl: options?.fetchImpl ?? fetch,
      now,
      timeoutMs: options?.timeoutMs ?? PROVIDER_TIMEOUT_MS,
    }).finally(() => {
      inFlightRequest = null;
    });
  }

  const providerValue = await inFlightRequest;
  if (providerValue) {
    providerCache = {
      freshUntil: now + PROVIDER_CACHE_MS,
      value: providerValue,
    };
    lastValidProviderValue = providerValue;
    return providerValue;
  }

  const configuredValue = environmentFallback(env, now);
  if (configuredValue) return configuredValue;

  if (lastValidProviderValue) {
    return { ...lastValidProviderValue, source: "Último valor válido" };
  }

  return { rate: null, updatedAt: null, source: null };
}

export function resetPlansExchangeRateCacheForTests(): void {
  providerCache = null;
  lastValidProviderValue = null;
  inFlightRequest = null;
}
