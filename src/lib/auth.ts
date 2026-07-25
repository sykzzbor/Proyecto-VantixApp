import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/prisma";
import {
  getGoogleSocialProviderConfig,
  GOOGLE_ACCOUNT_LINKING,
} from "@/lib/google-auth";
import {
  CANONICAL_APP_ORIGIN,
  normalizePublicOrigin,
  WWW_APP_ORIGIN,
} from "@/lib/public-domain";
import { sendEmailVerification } from "@/server/auth/email-verification";
import { EMAIL_VERIFICATION_TTL_MINUTES } from "@/server/auth/verification-token";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validatePassword,
} from "@/server/auth/password-policy";
import { notifyNewSignIn } from "@/server/auth/notifications";
import { sendTransactionalEmail } from "@/server/email/send";
import {
  existingAccountSignUpTemplate,
  passwordChangedTemplate,
  resetPasswordTemplate,
} from "@/server/email/templates";
import { canonicalPublicUrl } from "@/lib/public-domain";

function getConfiguredOrigin(value: string | undefined) {
  return normalizePublicOrigin(value) ?? undefined;
}

function getVercelOrigin(host: string | undefined) {
  const value = host?.trim();
  return value ? getConfiguredOrigin(`https://${value}`) : undefined;
}

const canonicalOrigin =
  getConfiguredOrigin(process.env.BETTER_AUTH_URL) ?? CANONICAL_APP_ORIGIN;
const trustedOrigins = Array.from(
  new Set(
    [
      canonicalOrigin,
      CANONICAL_APP_ORIGIN,
      WWW_APP_ORIGIN,
      getVercelOrigin(process.env.VERCEL_URL),
      getVercelOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL),
      process.env.NODE_ENV === "development"
        ? "http://localhost:3000"
        : undefined,
    ].filter((origin): origin is string => Boolean(origin))
  )
);

const allowedHosts = trustedOrigins.map((origin) => new URL(origin).host);
const googleProvider = getGoogleSocialProviderConfig();

const RESET_PASSWORD_TTL_MINUTES = 30;

/** Rutas donde el cuerpo trae una contraseña nueva que debe pasar la política. */
const NEW_PASSWORD_PATHS = new Map<string, string>([
  ["/sign-up/email", "password"],
  ["/reset-password", "newPassword"],
  ["/change-password", "newPassword"],
  ["/set-password", "newPassword"],
]);

/**
 * Aplica la política de contraseñas en el servidor.
 *
 * `minPasswordLength` de Better Auth solo mide el largo. El resto (variedad,
 * contraseñas comunes, que no contenga el correo) se valida acá, antes de que
 * el endpoint haga nada, para que no dependa del formulario del navegador.
 */
const enforcePasswordPolicy = createAuthMiddleware(async (ctx) => {
  const field = NEW_PASSWORD_PATHS.get(ctx.path);
  if (!field) return;

  const body = ctx.body as Record<string, unknown> | undefined;
  const password = body?.[field];
  if (typeof password !== "string") return;

  const email = typeof body?.email === "string" ? body.email : null;
  const result = validatePassword(password, email);
  if (!result.ok) {
    throw new APIError("BAD_REQUEST", {
      code: "PASSWORD_TOO_WEAK",
      message: result.message,
    });
  }
});

export const auth = betterAuth({
  appName: "VantixApp",
  baseURL:
    allowedHosts.length > 0
      ? {
          allowedHosts,
          protocol: "auto",
          fallback: canonicalOrigin,
        }
      : canonicalOrigin,
  trustedOrigins,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  socialProviders: googleProvider ? { google: googleProvider } : {},
  account: {
    encryptOAuthTokens: true,
    accountLinking: GOOGLE_ACCOUNT_LINKING,
  },
  emailAndPassword: {
    enabled: true,
    /**
     * El eje de todo el endurecimiento: sin correo verificado no hay sesión.
     * Como efecto secundario, `/sign-up/email` deja de revelar si un correo ya
     * está registrado (Better Auth devuelve una respuesta sintética idéntica).
     */
    requireEmailVerification: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,
    resetPasswordTokenExpiresIn: RESET_PASSWORD_TTL_MINUTES * 60,
    /** Un cambio de contraseña invalida todo lo abierto con la anterior. */
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url, token }) => {
      // Better Auth guarda un token por pedido y no borra los previos, así que
      // un enlace viejo seguiría sirviendo. Se descartan acá los del usuario
      // que no sean el recién emitido.
      await prisma.verification.deleteMany({
        where: {
          identifier: { startsWith: "reset-password:" },
          value: user.id,
          NOT: { identifier: `reset-password:${token}` },
        },
      });

      await sendTransactionalEmail(
        user.email,
        resetPasswordTemplate({
          name: user.name,
          url,
          expiresInMinutes: RESET_PASSWORD_TTL_MINUTES,
        })
      );
    },
    onPasswordReset: async ({ user }) => {
      await sendTransactionalEmail(
        user.email,
        passwordChangedTemplate({ name: user.name, changedAt: new Date() })
      );
    },
    /**
     * Con `requireEmailVerification` la pantalla de registro ya no puede decir
     * "ese correo existe". El aviso va a la casilla del dueño real, que es
     * quien tiene derecho a enterarse.
     */
    onExistingUserSignUp: async ({ user }) => {
      await sendTransactionalEmail(
        user.email,
        existingAccountSignUpTemplate({ name: user.name })
      );
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    /**
     * Se dispara recién después de validar la contraseña, así que no sirve
     * como forma de bombardear una casilla ajena.
     */
    sendOnSignIn: true,
    /** Verificar no inicia sesión: la persona vuelve al login a propósito. */
    autoSignInAfterVerification: false,
    expiresIn: EMAIL_VERIFICATION_TTL_MINUTES * 60,
    sendVerificationEmail: async ({ user }) => {
      // Se ignoran `url` y `token` de Better Auth: son un JWT sin estado que
      // sirve varias veces. VantixApp emite el suyo, de un solo uso.
      await sendEmailVerification({
        userId: user.id,
        email: user.email,
        name: user.name,
      });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 días
    updateAge: 60 * 60 * 24,
    /**
     * Una hora para considerar "reciente" una sesión. Better Auth lo exige en
     * las operaciones sensibles (borrar la cuenta, cambiar el correo).
     */
    freshAge: 60 * 60,
  },
  rateLimit: {
    enabled: true,
    /**
     * En memoria no sirve: cada invocación serverless de Vercel arranca con su
     * propio contador, así que basta con provocar instancias nuevas para
     * saltearse el límite. La tabla lo hace compartido y atómico.
     */
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 8 },
      "/sign-up/email": { window: 60 * 15, max: 5 },
      "/sign-in/social": { window: 60, max: 10 },
      "/request-password-reset": { window: 60 * 15, max: 4 },
      "/reset-password": { window: 60 * 15, max: 6 },
      "/send-verification-email": { window: 60 * 15, max: 4 },
      "/change-password": { window: 60 * 15, max: 6 },
      "/change-email": { window: 60 * 15, max: 4 },
      "/delete-user": { window: 60 * 15, max: 3 },
    },
  },
  advanced: {
    ipAddress: {
      /**
       * Detrás de Vercel, `x-forwarded-for` puede traer lo que el cliente
       * quiera al frente de la cadena. Las dos primeras las escribe el proxy.
       */
      ipAddressHeaders: ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"],
      /** Un /64 de IPv6 es un solo cliente, no billones de cupos distintos. */
      ipv6Subnet: 64,
    },
    /** También en Preview: nunca viaja la cookie de sesión por HTTP plano. */
    useSecureCookies: process.env.NODE_ENV !== "development",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
    },
  },
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          // Nunca puede romper un inicio de sesión legítimo.
          try {
            await notifyNewSignIn({
              userId: session.userId,
              userAgent: session.userAgent ?? null,
              sessionId: session.id,
              signedInAt: session.createdAt ?? new Date(),
            });
          } catch {
            // Silencioso a propósito: el detalle iría a los logs con datos del usuario.
          }
        },
      },
    },
  },
  hooks: {
    before: enforcePasswordPolicy,
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

/** URL canónica a la que vuelve el usuario después de verificar su correo. */
export const VERIFIED_LOGIN_URL = canonicalPublicUrl("/login?verificado=1");
