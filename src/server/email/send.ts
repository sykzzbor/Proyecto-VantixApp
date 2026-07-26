import type { EmailMessage } from "@/server/email/templates";

/**
 * Envío de correo transaccional.
 *
 * Un único adaptador HTTP (Resend) para no sumar dependencias al bundle del
 * servidor. En desarrollo, sin API key, el correo se imprime en consola SIN el
 * cuerpo ni los enlaces: los enlaces de verificación y recuperación son
 * credenciales de un solo uso y no pueden terminar en los logs de Vercel.
 */

export type EmailProvider = "resend" | "console" | "none";

export type SendEmailResult =
  | { ok: true; provider: EmailProvider }
  | { ok: false; reason: "not_configured" | "provider_error" };

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getEmailProvider(): EmailProvider {
  const configured = readEnv("EMAIL_PROVIDER")?.toLowerCase();
  if (configured === "resend" || configured === "console" || configured === "none") {
    return configured;
  }
  if (readEnv("RESEND_API_KEY")) return "resend";
  return process.env.NODE_ENV === "production" ? "none" : "console";
}

export const DEFAULT_EMAIL_FROM = "Vantix <no-reply@vantixapp.com.ar>";

const PLAIN_ADDRESS = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const NAMED_ADDRESS = /^[^<>]+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>$/;

/**
 * Normaliza el remitente configurado.
 *
 * Resend rechaza con 422 cualquier `from` que no sea `correo@dominio` o
 * `Nombre <correo@dominio>`, y el fallo es silencioso para el usuario: la
 * pantalla dice "revisá tu correo" mientras no sale ni un mensaje. El error
 * más fácil de cometer es pegar el valor en el panel de Vercel con las
 * comillas que lleva en el `.env.example`, así que se quitan y, si aun así el
 * formato no sirve, se cae al remitente por defecto en vez de dejar la app sin
 * poder registrar a nadie.
 */
export function normalizeEmailFrom(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return DEFAULT_EMAIL_FROM;

  const unquoted = trimmed.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  if (PLAIN_ADDRESS.test(unquoted) || NAMED_ADDRESS.test(unquoted)) {
    return unquoted;
  }

  console.error(
    "[VantixApp][email] EMAIL_FROM no tiene un formato válido " +
      '("correo@dominio" o "Nombre <correo@dominio>"); se usa el remitente por defecto.'
  );
  return DEFAULT_EMAIL_FROM;
}

export function getEmailFrom(): string {
  return normalizeEmailFrom(process.env.EMAIL_FROM);
}

/** `true` cuando la app puede efectivamente entregar correo. */
export function isEmailDeliveryConfigured(): boolean {
  const provider = getEmailProvider();
  if (provider === "resend") return Boolean(readEnv("RESEND_API_KEY"));
  return provider === "console";
}

/**
 * Recorta el correo para los logs: `ma***@empresa.com`. Alcanza para
 * correlacionar un incidente sin dejar la lista de direcciones en texto plano.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(3)}@${domain}`;
}

/** Reemplaza cualquier dirección de correo por `<correo>`. */
export function redactEmails(value: string): string {
  return value.replace(/[^\s<>"'(]+@[^\s<>"',;)]+/g, "<correo>");
}

/**
 * Resume el error de Resend para el log: nombre del error y mensaje, sin
 * direcciones y acotado para que un cuerpo enorme no inunde los logs.
 */
async function describeResendError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      name?: unknown;
      message?: unknown;
      error?: { message?: unknown };
    };
    const name = typeof body.name === "string" ? body.name : "sin_nombre";
    const raw =
      typeof body.message === "string"
        ? body.message
        : typeof body.error?.message === "string"
          ? body.error.message
          : "";
    return `${name} — ${redactEmails(raw).slice(0, 300) || "sin detalle"}`;
  } catch {
    return "respuesta ilegible del proveedor";
  }
}

async function sendWithResend(
  apiKey: string,
  to: string,
  message: EmailMessage
): Promise<SendEmailResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const replyTo = readEnv("EMAIL_REPLY_TO");
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: getEmailFrom(),
        to: [to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Se registra el motivo que devuelve Resend porque sin él un rechazo es
      // imposible de diagnosticar: "422" no dice si falta verificar el dominio,
      // si el remitente es inválido o si la cuenta está en modo de prueba.
      // Las direcciones se redactan: el mensaje suele citar destinatario o
      // remitente y no tienen por qué quedar en los logs de la plataforma.
      console.error(
        `[VantixApp][email] Resend rechazó el envío (status ${response.status}): ${await describeResendError(response)}`
      );
      return { ok: false, reason: "provider_error" };
    }
    return { ok: true, provider: "resend" };
  } catch (error) {
    console.error(
      "[VantixApp][email] No se pudo contactar al proveedor de correo:",
      error instanceof Error ? error.name : "error desconocido"
    );
    return { ok: false, reason: "provider_error" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendTransactionalEmail(
  to: string,
  message: EmailMessage
): Promise<SendEmailResult> {
  const provider = getEmailProvider();

  if (provider === "resend") {
    const apiKey = readEnv("RESEND_API_KEY");
    if (!apiKey) {
      console.error(
        "[VantixApp][email] EMAIL_PROVIDER=resend pero falta RESEND_API_KEY."
      );
      return { ok: false, reason: "not_configured" };
    }
    return sendWithResend(apiKey, to, message);
  }

  if (provider === "console") {
    console.info(
      `[VantixApp][email] (dev) "${message.subject}" → ${maskEmail(to)}`
    );
    // El enlace solo se imprime fuera de producción. En Vercel
    // `NODE_ENV === "production"`, así que ningún token de un solo uso puede
    // terminar en los logs de la plataforma aunque se configure mal el proveedor.
    if (process.env.NODE_ENV !== "production") {
      const link = message.text.match(/https?:\/\/\S+/g)?.find((url) =>
        /token=|\/verificar-email|\/reset-password\//.test(url)
      );
      if (link) console.info(`[VantixApp][email] (dev) enlace: ${link}`);
    }
    return { ok: true, provider: "console" };
  }

  console.error(
    "[VantixApp][email] No hay proveedor de correo configurado; el mensaje no se envió."
  );
  return { ok: false, reason: "not_configured" };
}
