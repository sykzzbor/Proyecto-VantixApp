import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/prisma";

/** Dominio oficial de producción: fallback estable si falta BETTER_AUTH_URL. */
const OFFICIAL_ORIGIN = "https://proyecto-vantix-app.vercel.app";

function getConfiguredOrigin(value: string | undefined) {
  const url = value?.trim();
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function getVercelOrigin(host: string | undefined) {
  const value = host?.trim();
  return value ? getConfiguredOrigin(`https://${value}`) : undefined;
}

const canonicalOrigin =
  getConfiguredOrigin(process.env.BETTER_AUTH_URL) ?? OFFICIAL_ORIGIN;
const trustedOrigins = Array.from(
  new Set(
    [
      canonicalOrigin,
      OFFICIAL_ORIGIN,
      getVercelOrigin(process.env.VERCEL_URL),
      getVercelOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL),
      process.env.NODE_ENV === "development"
        ? "http://localhost:3000"
        : undefined,
    ].filter((origin): origin is string => Boolean(origin))
  )
);

const allowedHosts = trustedOrigins.map((origin) => new URL(origin).host);

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
