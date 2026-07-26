import { CANONICAL_APP_ORIGIN, canonicalPublicUrl } from "@/lib/public-domain";

/**
 * Plantillas de los correos transaccionales de VantixApp.
 *
 * Son funciones puras: reciben datos y devuelven asunto, HTML y texto plano.
 * No leen variables de entorno ni escriben logs, así que se pueden probar sin
 * proveedor de correo. El envío vive en `send.ts`.
 */

export const SUPPORT_URL = canonicalPublicUrl("/soporte");
export const PRIVACY_URL = canonicalPublicUrl("/privacidad");
export const LOGIN_URL = canonicalPublicUrl("/login");

/** Aviso obligatorio al pie de todos los correos de seguridad. */
export const SECURITY_NOTICE =
  "Si no solicitaste esta acción, ignorá este correo o contactá a soporte.";

export type EmailMessage = {
  subject: string;
  html: string;
  text: string;
};

/**
 * Escapa el texto que se interpola en el HTML. Los nombres los elige el
 * usuario, así que un `<script>` en el nombre no puede llegar entero al
 * cliente de correo de otra persona.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function greetingName(name: string | null | undefined): string {
  const clean = name?.trim().split(/\s+/)[0] ?? "";
  return clean.length >= 2 && clean.length <= 40 ? clean : "";
}

type LayoutInput = {
  title: string;
  preheader: string;
  intro: string;
  /** Párrafos del cuerpo, ya en texto plano. */
  body: string[];
  action?: { label: string; url: string };
  /** Texto que acompaña al botón (por ejemplo, el vencimiento del enlace). */
  actionNote?: string;
};

/**
 * Layout responsive basado en tablas: es lo único que renderiza igual en
 * Gmail, Outlook y Apple Mail. Los colores van inline porque la mayoría de
 * los clientes descarta `<style>`.
 */
function renderHtml(input: LayoutInput): string {
  const actionBlock = input.action
    ? `
              <tr>
                <td align="center" style="padding:8px 0 4px;">
                  <a href="${escapeHtml(input.action.url)}" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:15px;font-weight:600;line-height:20px;text-decoration:none;padding:14px 28px;border-radius:10px;">${escapeHtml(input.action.label)}</a>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 0 0;font-size:13px;line-height:20px;color:#64748b;">
                  ${input.actionNote ? `${escapeHtml(input.actionNote)}<br />` : ""}
                  Si el botón no funciona, copiá y pegá este enlace en tu navegador:<br />
                  <span style="word-break:break-all;color:#334155;">${escapeHtml(input.action.url)}</span>
                </td>
              </tr>`
    : "";

  const paragraphs = input.body
    .map(
      (paragraph) =>
        `<tr><td style="padding:0 0 14px;font-size:15px;line-height:24px;color:#334155;">${escapeHtml(paragraph)}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;">
            <tr>
              <td style="padding:28px 32px 8px;">
                <p style="margin:0;font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Vantix</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:8px 0 12px;font-size:21px;line-height:28px;font-weight:700;letter-spacing:-0.03em;color:#0f172a;">${escapeHtml(input.title)}</td>
                  </tr>
                  <tr><td style="padding:0 0 14px;font-size:15px;line-height:24px;color:#334155;">${escapeHtml(input.intro)}</td></tr>
                  ${paragraphs}
                  ${actionBlock}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;border-top:1px solid #e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <p style="margin:0 0 10px;font-size:13px;line-height:20px;color:#64748b;">${escapeHtml(SECURITY_NOTICE)}</p>
                <p style="margin:0;font-size:12px;line-height:18px;color:#94a3b8;">
                  <a href="${SUPPORT_URL}" style="color:#64748b;text-decoration:underline;">Soporte</a> ·
                  <a href="${PRIVACY_URL}" style="color:#64748b;text-decoration:underline;">Privacidad</a> ·
                  <a href="${CANONICAL_APP_ORIGIN}" style="color:#64748b;text-decoration:underline;">vantixapp.com.ar</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(input: LayoutInput): string {
  const lines = [input.title, "", input.intro, "", ...input.body];
  if (input.action) {
    lines.push("", `${input.action.label}: ${input.action.url}`);
    if (input.actionNote) lines.push(input.actionNote);
  }
  lines.push("", SECURITY_NOTICE, "", `Soporte: ${SUPPORT_URL}`, "Vantix — vantixapp.com.ar");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function build(input: LayoutInput, subject: string): EmailMessage {
  return { subject, html: renderHtml(input), text: renderText(input) };
}

function withGreeting(name: string | null | undefined, sentence: string): string {
  const first = greetingName(name);
  return first ? `Hola ${first}: ${sentence}` : sentence;
}

/** Fecha legible en español rioplatense, en la zona horaria de Argentina. */
export function formatEventTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(date);
}

export function verifyEmailTemplate(input: {
  name?: string | null;
  url: string;
  expiresInMinutes: number;
}): EmailMessage {
  return build(
    {
      title: "Verificá tu correo",
      preheader: "Confirmá tu dirección para activar tu cuenta de Vantix.",
      intro: withGreeting(
        input.name,
        "confirmá esta dirección para activar tu cuenta de Vantix."
      ),
      body: [
        "Hasta que la verifiques no vas a poder iniciar sesión ni crear tu espacio de trabajo.",
      ],
      action: { label: "Verificar mi correo", url: input.url },
      actionNote: `El enlace vence en ${input.expiresInMinutes} minutos y se puede usar una sola vez.`,
    },
    "Verificá tu correo en Vantix"
  );
}

export function resendVerificationTemplate(input: {
  name?: string | null;
  url: string;
  expiresInMinutes: number;
}): EmailMessage {
  return build(
    {
      title: "Tu nuevo enlace de verificación",
      preheader: "Generamos un enlace nuevo para confirmar tu correo.",
      intro: withGreeting(
        input.name,
        "pediste otro enlace para verificar tu correo. Acá está."
      ),
      body: [
        "Los enlaces anteriores dejaron de servir: solo funciona este.",
      ],
      action: { label: "Verificar mi correo", url: input.url },
      actionNote: `El enlace vence en ${input.expiresInMinutes} minutos y se puede usar una sola vez.`,
    },
    "Tu nuevo enlace de verificación de Vantix"
  );
}

export function resetPasswordTemplate(input: {
  name?: string | null;
  url: string;
  expiresInMinutes: number;
}): EmailMessage {
  return build(
    {
      title: "Restablecer tu contraseña",
      preheader: "Elegí una contraseña nueva para tu cuenta de Vantix.",
      intro: withGreeting(
        input.name,
        "recibimos un pedido para restablecer la contraseña de tu cuenta."
      ),
      body: [
        "Tu contraseña actual sigue vigente hasta que completes el cambio.",
      ],
      action: { label: "Elegir contraseña nueva", url: input.url },
      actionNote: `El enlace vence en ${input.expiresInMinutes} minutos y se puede usar una sola vez.`,
    },
    "Restablecé tu contraseña de Vantix"
  );
}

export function passwordChangedTemplate(input: {
  name?: string | null;
  changedAt: Date;
}): EmailMessage {
  return build(
    {
      title: "Tu contraseña cambió",
      preheader: "Confirmamos el cambio de contraseña de tu cuenta.",
      intro: withGreeting(
        input.name,
        `la contraseña de tu cuenta se cambió el ${formatEventTimestamp(input.changedAt)}.`
      ),
      body: [
        "Cerramos las demás sesiones abiertas por seguridad: vas a tener que volver a entrar en tus otros dispositivos.",
        "Si fuiste vos, no hay nada más que hacer.",
      ],
      action: { label: "Ir a Vantix", url: LOGIN_URL },
    },
    "Cambiaste la contraseña de tu cuenta de Vantix"
  );
}

export function newSignInTemplate(input: {
  name?: string | null;
  signedInAt: Date;
  /** Descripción del dispositivo, ya recortada. Nunca la IP completa. */
  device: string | null;
}): EmailMessage {
  const body = [
    "Si reconocés este acceso, podés ignorar este correo.",
    "Si no fuiste vos, cambiá tu contraseña y cerrá las sesiones abiertas desde Configuración.",
  ];
  if (input.device) body.unshift(`Dispositivo: ${input.device}`);

  return build(
    {
      title: "Nuevo inicio de sesión",
      preheader: "Detectamos un acceso nuevo a tu cuenta de Vantix.",
      intro: withGreeting(
        input.name,
        `entraron a tu cuenta el ${formatEventTimestamp(input.signedInAt)}.`
      ),
      body,
      action: { label: "Revisar mis sesiones", url: canonicalPublicUrl("/dashboard/configuracion") },
    },
    "Nuevo inicio de sesión en tu cuenta de Vantix"
  );
}

export function emailChangedTemplate(input: {
  name?: string | null;
  newEmail: string;
  changedAt: Date;
}): EmailMessage {
  return build(
    {
      title: "Cambió el correo de tu cuenta",
      preheader: "Actualizamos la dirección asociada a tu cuenta de Vantix.",
      intro: withGreeting(
        input.name,
        `el correo de tu cuenta cambió el ${formatEventTimestamp(input.changedAt)}.`
      ),
      body: [
        `La cuenta ahora usa ${input.newEmail}.`,
        "A partir de ahora vas a iniciar sesión con esa dirección.",
      ],
      action: { label: "Ir a Vantix", url: LOGIN_URL },
    },
    "Cambió el correo de tu cuenta de Vantix"
  );
}

/**
 * Aviso al dueño de una cuenta existente cuando alguien intenta registrarse
 * con su correo. Reemplaza el mensaje "ya existe una cuenta" en la pantalla de
 * registro, que le confirmaría a un desconocido que la dirección está tomada.
 */
export function existingAccountSignUpTemplate(input: {
  name?: string | null;
}): EmailMessage {
  return build(
    {
      title: "Alguien intentó registrarse con tu correo",
      preheader: "Ya tenés una cuenta de Vantix con esta dirección.",
      intro: withGreeting(
        input.name,
        "alguien quiso crear una cuenta nueva de Vantix con tu dirección de correo."
      ),
      body: [
        "No creamos ninguna cuenta y tu contraseña no cambió.",
        "Si fuiste vos y olvidaste que ya tenías cuenta, entrá con tu contraseña o pedí una nueva desde “¿La olvidaste?”.",
      ],
      action: { label: "Iniciar sesión", url: LOGIN_URL },
    },
    "Intento de registro con tu correo en Vantix"
  );
}

// ============================================================
// Facturación y ciclo de vida de la cuenta
// ============================================================

/** Importe en pesos, o `null` cuando el proveedor no informó monto. */
function pesos(amountArs: number | null): string | null {
  if (amountArs === null) return null;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amountArs);
}

export function paymentApprovedTemplate(input: {
  name?: string | null;
  planName: string;
  amountArs: number | null;
  nextBillingAt: Date | null;
}): EmailMessage {
  const importe = pesos(input.amountArs);
  const body = [
    `Plan ${input.planName}${importe ? ` · ${importe} ARS` : ""}.`,
  ];
  if (input.nextBillingAt) {
    body.push(`El próximo cobro está previsto para el ${formatEventTimestamp(input.nextBillingAt)}.`);
  }
  body.push("Ya tenés el acceso completo habilitado.");

  return build(
    {
      title: "Recibimos tu pago",
      preheader: "Tu suscripción de Vantix quedó activa.",
      intro: withGreeting(input.name, "confirmamos el pago de tu suscripción."),
      body,
      action: { label: "Ir a mi panel", url: canonicalPublicUrl("/dashboard") },
    },
    "Pago confirmado · Vantix"
  );
}

export function paymentRejectedTemplate(input: {
  name?: string | null;
  planName: string;
}): EmailMessage {
  return build(
    {
      title: "No pudimos procesar tu pago",
      preheader: "El cobro de tu suscripción fue rechazado.",
      intro: withGreeting(
        input.name,
        `el cobro del plan ${input.planName} fue rechazado.`
      ),
      body: [
        "Suele ser por fondos insuficientes o por un límite de la tarjeta. No se hizo ningún cargo.",
        "Podés reintentar el pago desde la sección de facturación; si el problema sigue, probá con otro medio de pago.",
      ],
      action: {
        label: "Reintentar el pago",
        url: canonicalPublicUrl("/dashboard/planes"),
      },
    },
    "No pudimos procesar tu pago · Vantix"
  );
}

export function subscriptionCanceledTemplate(input: {
  name?: string | null;
  planName: string;
  accessUntil: Date | null;
}): EmailMessage {
  const body = input.accessUntil
    ? [`Conservás el acceso hasta el ${formatEventTimestamp(input.accessUntil)}.`]
    : ["El acceso se limita al terminar el período ya pago."];
  body.push("No se van a hacer más cobros. Podés volver a contratar cuando quieras.");

  return build(
    {
      title: "Cancelamos tu suscripción",
      preheader: "No vamos a hacer más cobros.",
      intro: withGreeting(
        input.name,
        `cancelamos tu suscripción al plan ${input.planName}.`
      ),
      body,
      action: {
        label: "Ver planes",
        url: canonicalPublicUrl("/dashboard/planes"),
      },
    },
    "Tu suscripción quedó cancelada · Vantix"
  );
}

/**
 * Aviso de prueba por vencer. `daysLeft` 0 significa que ya venció.
 */
export function trialReminderTemplate(input: {
  name?: string | null;
  daysLeft: 3 | 1 | 0;
  endsAt: Date;
}): EmailMessage {
  if (input.daysLeft === 0) {
    return build(
      {
        title: "Tu prueba gratuita terminó",
        preheader: "Elegí un plan para seguir operando.",
        intro: withGreeting(input.name, "se terminó tu prueba gratuita de Vantix."),
        body: [
          "Tus datos siguen intactos: conversaciones, catálogo y configuración quedan tal como estaban.",
          "Para volver a operar, elegí un plan. El acceso se reactiva apenas se acredita el pago.",
        ],
        action: {
          label: "Elegir un plan",
          url: canonicalPublicUrl("/dashboard/planes"),
        },
      },
      "Tu prueba de Vantix terminó"
    );
  }

  const cuando = input.daysLeft === 1 ? "mañana" : `en ${input.daysLeft} días`;
  return build(
    {
      title: `Tu prueba termina ${cuando}`,
      preheader: `Te quedan ${input.daysLeft} día(s) de prueba.`,
      intro: withGreeting(
        input.name,
        `tu prueba gratuita termina ${cuando}, el ${formatEventTimestamp(input.endsAt)}.`
      ),
      body: [
        "Si elegís un plan antes de esa fecha, seguís trabajando sin interrupciones.",
        "Si no, tus datos se conservan igual y podés contratar cuando quieras.",
      ],
      action: {
        label: "Ver planes",
        url: canonicalPublicUrl("/dashboard/planes"),
      },
    },
    `Tu prueba de Vantix termina ${cuando}`
  );
}

export function accountDeletedTemplate(input: {
  name?: string | null;
  deletedAt: Date;
}): EmailMessage {
  return build(
    {
      title: "Tu cuenta fue eliminada",
      preheader: "Confirmamos la eliminación de tu cuenta de Vantix.",
      intro: withGreeting(
        input.name,
        `eliminamos tu cuenta de Vantix el ${formatEventTimestamp(input.deletedAt)}.`
      ),
      body: [
        "Se borraron tus datos personales y los espacios de trabajo en los que eras la única persona.",
        "La acción es definitiva: no podemos recuperar la cuenta. Si querés volver a usar Vantix, vas a tener que crear una nueva.",
      ],
    },
    "Tu cuenta de Vantix fue eliminada"
  );
}

// ============================================================
// Equipo
// ============================================================

export function teamInvitationTemplate(input: {
  organizationName: string;
  inviterName?: string | null;
  roleName: string;
  url: string;
  expiresInDays: number;
}): EmailMessage {
  const quien = input.inviterName?.trim()
    ? `${input.inviterName.trim()} te invitó`
    : "Te invitaron";

  return build(
    {
      title: `Te sumaron a ${input.organizationName}`,
      preheader: `Tenés una invitación para trabajar en ${input.organizationName}.`,
      intro: `${quien} a trabajar en ${input.organizationName} dentro de Vantix.`,
      body: [
        `Vas a entrar con el rol de ${input.roleName}.`,
        "Si todavía no tenés cuenta, vas a poder crearla en el mismo paso.",
      ],
      action: { label: "Aceptar la invitación", url: input.url },
      actionNote: `La invitación vence en ${input.expiresInDays} días.`,
    },
    `Invitación para sumarte a ${input.organizationName} · Vantix`
  );
}
