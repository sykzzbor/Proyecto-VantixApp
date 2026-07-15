import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma HMAC SHA-256 de los webhooks de automatización. La comparación es
 * resistente a timing attacks y se hace SIEMPRE sobre los bytes exactos del
 * cuerpo recibido (nunca sobre un JSON re-serializado).
 */

const SIGNATURE_PATTERN = /^sha256=([a-f0-9]{64})$/i;

function hmacDigest(value: string, secret: string) {
  return createHmac("sha256", secret)
    .update(Buffer.from(value, "utf8"))
    .digest();
}

function matchesSignature(
  value: string,
  signatureHeader: string | null | undefined,
  secret: string
) {
  if (!signatureHeader || !secret) return false;
  const match = SIGNATURE_PATTERN.exec(signatureHeader.trim());
  if (!match?.[1]) return false;

  const received = Buffer.from(match[1], "hex");
  const expected = hmacDigest(value, secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function signAutomationBody(body: string, secret: string): string {
  const digest = hmacDigest(body, secret).toString("hex");
  return `sha256=${digest}`;
}

export function verifyAutomationSignature(
  body: string,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  return matchesSignature(body, signatureHeader, secret);
}

/**
 * Las acciones cuyo body contiene únicamente IDs firman también el timestamp
 * del header. Así el timestamp no puede renovarse sobre un body capturado sin
 * conocer el secreto, mientras la verificación sigue usando el body crudo.
 */
export function signTimestampedAutomationBody(
  body: string,
  timestampHeader: string,
  secret: string
) {
  const digest = hmacDigest(`${timestampHeader}.${body}`, secret).toString("hex");
  return `sha256=${digest}`;
}

export function verifyTimestampedAutomationSignature(
  body: string,
  timestampHeader: string | null | undefined,
  signatureHeader: string | null | undefined,
  secret: string
) {
  if (!timestampHeader) return false;
  return matchesSignature(
    `${timestampHeader}.${body}`,
    signatureHeader,
    secret
  );
}

/**
 * Verifica que el timestamp (epoch en milisegundos) esté dentro de la ventana
 * de tolerancia, para rechazar callbacks viejos (anti-replay) y con reloj muy
 * adelantado.
 */
export function isTimestampFresh(
  timestampHeader: string | null | undefined,
  toleranceMs: number,
  now: number = Date.now()
): boolean {
  if (!timestampHeader) return false;
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  return Math.abs(now - timestamp) <= toleranceMs;
}
