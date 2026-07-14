const REDACTED = "[oculto]";
const MAX_DEPTH = 10;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 200;

const SENSITIVE_KEYS = [
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "webhooksecret",
  "credential",
];

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveAutomationKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive));
}

export function sanitizeAutomationValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (depth > MAX_DEPTH) return "[contenido profundo omitido]";
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeAutomationMessage(value, 1000) ?? "";
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[referencia circular omitida]";
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeAutomationValue(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) items.push("[elementos adicionales omitidos]");
    return items;
  }

  const output: Record<string, unknown> = {};
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  for (const [key, nested] of entries) {
    output[key] = isSensitiveAutomationKey(key)
      ? REDACTED
      : sanitizeAutomationValue(nested, depth + 1, seen);
  }
  if (Object.keys(value).length > MAX_OBJECT_KEYS) {
    output._omitted = "[claves adicionales omitidas]";
  }
  return output;
}

/** Sanitiza errores antes de persistirlos o enviarlos al navegador. */
export function sanitizeAutomationMessage(
  value: string | null | undefined,
  maxLength = 500
): string | null {
  if (!value) return null;
  const firstLine = value.split(/\r?\n/, 1)[0] ?? "";
  return firstLine
    .replace(/Bearer\s+\S+/gi, "Bearer [oculto]")
    .replace(
      /(?:postgresql|postgres|https?):\/\/[^\s"']+/gi,
      "[url oculta]"
    )
    .replace(
      /(password|secret|token|authorization|cookie|api[_-]?key|credential)(\s*[:=]\s*)\S+/gi,
      "$1$2[oculto]"
    )
    .slice(0, maxLength);
}

export function shortAutomationId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function maskIdempotencyKey(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 12)}…${value.slice(-6)}`;
}

export function safeExternalExecutionId(value: string | null): string | null {
  if (!value) return null;
  const safe = value.replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 120);
  return safe || null;
}
