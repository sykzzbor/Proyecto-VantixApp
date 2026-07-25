import { prisma } from "@/lib/prisma";
import { sendTransactionalEmail } from "@/server/email/send";
import { newSignInTemplate } from "@/server/email/templates";

/**
 * Aviso de "nuevo inicio de sesión".
 *
 * Solo se manda cuando el acceso viene de un dispositivo que la cuenta no
 * había usado antes. Avisar en cada login convertiría el correo en ruido y la
 * gente dejaría de leerlo justo cuando importa.
 */

/**
 * Reduce el user agent a "navegador · sistema". El string completo es una
 * huella bastante única del dispositivo y no hace falta guardarlo ni mostrarlo.
 */
export function describeUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;

  const browser =
    /\bEdg\//.test(userAgent) ? "Edge"
    : /\bOPR\/|\bOpera\b/.test(userAgent) ? "Opera"
    : /\bFirefox\//.test(userAgent) ? "Firefox"
    : /\bChrome\//.test(userAgent) ? "Chrome"
    : /\bSafari\//.test(userAgent) ? "Safari"
    : null;

  const system =
    /\biPhone\b/.test(userAgent) ? "iPhone"
    : /\biPad\b/.test(userAgent) ? "iPad"
    : /\bAndroid\b/.test(userAgent) ? "Android"
    : /\bMac OS X\b|\bMacintosh\b/.test(userAgent) ? "Mac"
    : /\bWindows\b/.test(userAgent) ? "Windows"
    : /\bLinux\b/.test(userAgent) ? "Linux"
    : null;

  if (!browser && !system) return null;
  return [browser, system].filter(Boolean).join(" · ");
}

/**
 * `true` si la cuenta ya tenía otra sesión con un dispositivo equivalente.
 * Se compara la descripción corta, no el user agent crudo: una actualización
 * menor del navegador no debería disparar una alerta.
 */
async function isKnownDevice(input: {
  userId: string;
  sessionId: string;
  device: string | null;
}): Promise<boolean> {
  const previous = await prisma.session.findMany({
    where: { userId: input.userId, NOT: { id: input.sessionId } },
    select: { userAgent: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Primera sesión de la cuenta: es el alta, no un acceso sospechoso.
  if (previous.length === 0) return true;

  return previous.some(
    (session) => describeUserAgent(session.userAgent) === input.device
  );
}

export async function notifyNewSignIn(input: {
  userId: string;
  sessionId: string;
  userAgent: string | null;
  signedInAt: Date;
}): Promise<{ sent: boolean }> {
  const device = describeUserAgent(input.userAgent);

  if (await isKnownDevice({ ...input, device })) return { sent: false };

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { name: true, email: true, emailVerified: true },
  });
  // Sin correo verificado no hay a dónde avisar de forma confiable.
  if (!user || !user.emailVerified) return { sent: false };

  const result = await sendTransactionalEmail(
    user.email,
    newSignInTemplate({
      name: user.name,
      signedInAt: input.signedInAt,
      device,
    })
  );
  return { sent: result.ok };
}
