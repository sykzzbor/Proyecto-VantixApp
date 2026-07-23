import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
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
    minPasswordLength: 8,
    resetPasswordTokenExpiresIn: 60 * 60, // 1 hora
    sendResetPassword: async ({ user, url }) => {
      // Etapa 1: todavía no hay proveedor de email integrado.
      // El enlace se imprime en la consola del servidor para poder probar
      // el flujo completo. Ver README para conectar un proveedor real.
      console.info(
        `[VantixApp] Enlace para restablecer la contraseña de ${user.email}:\n${url}`
      );
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 días
    updateAge: 60 * 60 * 24,
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
