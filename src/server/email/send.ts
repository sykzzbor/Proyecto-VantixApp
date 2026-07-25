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

export function getEmailFrom(): string {
  return readEnv("EMAIL_FROM") ?? "Vantix <no-reply@vantixapp.com.ar>";
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
      // Solo el status: el cuerpo del error puede repetir el destinatario.
      console.error(
        `[VantixApp][email] Resend rechazó el envío (status ${response.status}).`
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
