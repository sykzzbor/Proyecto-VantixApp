import { prisma } from "@/lib/prisma";
import { canonicalPublicUrl } from "@/lib/public-domain";
import { sendTransactionalEmail } from "@/server/email/send";
import {
  resendVerificationTemplate,
  verifyEmailTemplate,
} from "@/server/email/templates";
import {
  decideVerificationToken,
  EMAIL_VERIFICATION_TTL_MINUTES,
  EMAIL_VERIFICATION_TTL_MS,
  generateVerificationToken,
  hashVerificationToken,
  type VerificationTokenDecision,
} from "@/server/auth/verification-token";

/**
 * Emisión y consumo de los enlaces de verificación de correo.
 *
 * Better Auth solo avisa "hay que verificar a este usuario"; el token que
 * viaja en el correo lo emite y controla VantixApp para poder garantizar un
 * solo uso e invalidar los anteriores.
 */

export const VERIFY_EMAIL_PATH = "/verificar-email";

function verificationUrl(token: string): string {
  const url = new URL(VERIFY_EMAIL_PATH, canonicalPublicUrl("/"));
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * Emite un token nuevo y **borra los anteriores del mismo usuario**: el enlace
 * viejo que quedó en una casilla ajena o en un historial deja de servir en
 * cuanto la persona pide otro.
 */
export async function issueEmailVerificationToken(input: {
  userId: string;
  email: string;
  now?: Date;
}): Promise<{ token: string; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const token = generateVerificationToken();
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS);

  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId: input.userId } }),
    prisma.emailVerificationToken.create({
      data: {
        userId: input.userId,
        tokenHash: hashVerificationToken(token),
        email: input.email.toLowerCase(),
        expiresAt,
      },
    }),
  ]);

  return { token, expiresAt };
}

export async function sendEmailVerification(input: {
  userId: string;
  email: string;
  name?: string | null;
  /** `true` cuando lo pidió la persona desde "Reenviar", no el alta. */
  isResend?: boolean;
}): Promise<{ ok: boolean }> {
  const { token } = await issueEmailVerificationToken({
    userId: input.userId,
    email: input.email,
  });

  const message = (input.isResend ? resendVerificationTemplate : verifyEmailTemplate)({
    name: input.name,
    url: verificationUrl(token),
    expiresInMinutes: EMAIL_VERIFICATION_TTL_MINUTES,
  });

  const result = await sendTransactionalEmail(input.email, message);
  return { ok: result.ok };
}

export type ConsumeVerificationResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: "invalid" | "expired" | "already_used" | "email_changed" };

/**
 * Valida y consume un token. El `updateMany` condicionado a `consumedAt: null`
 * es lo que hace el uso único: si dos requests llegan con el mismo token, la
 * base deja que solo uno actualice la fila y el otro ve `count === 0`.
 */
export async function consumeEmailVerificationToken(
  rawToken: string,
  now: Date = new Date()
): Promise<ConsumeVerificationResult> {
  if (!rawToken || rawToken.length > 512) return { ok: false, reason: "invalid" };

  const tokenHash = hashVerificationToken(rawToken);
  const stored = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      email: true,
      expiresAt: true,
      consumedAt: true,
      user: { select: { email: true, emailVerified: true } },
    },
  });

  const decision: VerificationTokenDecision = decideVerificationToken({
    stored: stored
      ? {
          id: stored.id,
          userId: stored.userId,
          email: stored.email,
          expiresAt: stored.expiresAt,
          consumedAt: stored.consumedAt,
        }
      : null,
    currentEmail: stored?.user.email ?? null,
    now,
  });

  if (!decision.ok) return decision;

  const claimed = await prisma.emailVerificationToken.updateMany({
    where: { tokenHash, consumedAt: null },
    data: { consumedAt: now },
  });
  if (claimed.count === 0) return { ok: false, reason: "already_used" };

  await prisma.user.update({
    where: { id: decision.userId },
    data: { emailVerified: true },
  });

  return { ok: true, userId: decision.userId, email: decision.email };
}

/**
 * Busca al usuario para un reenvío. Devuelve `null` tanto si no existe como si
 * ya está verificado: quien llama responde igual en los dos casos y no puede
 * usarse la pantalla para descubrir qué direcciones están registradas.
 */
export async function findUserPendingVerification(email: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, name: true, email: true, emailVerified: true },
  });
  return user && !user.emailVerified ? user : null;
}

/** Borra tokens vencidos o ya usados. Pensado para un job programado. */
export async function purgeStaleVerificationTokens(
  now: Date = new Date()
): Promise<number> {
  const { count } = await prisma.emailVerificationToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lte: now } }, { consumedAt: { not: null } }],
    },
  });
  return count;
}
