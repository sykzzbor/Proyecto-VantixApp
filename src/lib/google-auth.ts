import type { GoogleOptions, GoogleProfile } from "better-auth/social-providers";
import { canonicalPublicUrl } from "@/lib/public-domain";

export const GOOGLE_IDENTITY_SCOPES = ["openid", "email", "profile"] as const;
export const GOOGLE_AUTH_CALLBACK_PATH = "/api/auth/callback/google";
export const GOOGLE_AUTH_PRODUCTION_CALLBACK =
  canonicalPublicUrl(GOOGLE_AUTH_CALLBACK_PATH);
export const GOOGLE_AUTH_LOCAL_CALLBACK =
  "http://localhost:3000/api/auth/callback/google";

export const GOOGLE_ACCOUNT_LINKING = {
  enabled: true,
  requireLocalEmailVerified: true,
  allowDifferentEmails: false,
  updateUserInfoOnLink: true,
} as const;

type GoogleAuthEnv = {
  GOOGLE_AUTH_CLIENT_ID?: string;
  GOOGLE_AUTH_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

function safeProfileImage(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function mapGoogleIdentityProfile(profile: GoogleProfile) {
  const name = profile.name?.trim().slice(0, 120) || undefined;
  const image = safeProfileImage(profile.picture);
  return {
    ...(name ? { name } : {}),
    ...(image ? { image } : {}),
  };
}

export function getGoogleSocialProviderConfig(
  env: GoogleAuthEnv = process.env as unknown as GoogleAuthEnv
): GoogleOptions | null {
  const authClientId = env.GOOGLE_AUTH_CLIENT_ID?.trim();
  const authClientSecret = env.GOOGLE_AUTH_CLIENT_SECRET?.trim();
  const hasDedicatedAuthConfig = Boolean(authClientId || authClientSecret);
  const clientId = hasDedicatedAuthConfig
    ? authClientId
    : env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = hasDedicatedAuthConfig
    ? authClientSecret
    : env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  return {
    clientId,
    clientSecret,
    // Se declaran explícitamente los únicos scopes de identidad. Calendar
    // conserva sus credenciales, callback y consentimiento separados.
    disableDefaultScope: true,
    scope: [...GOOGLE_IDENTITY_SCOPES],
    accessType: "online",
    prompt: "select_account",
    mapProfileToUser: mapGoogleIdentityProfile,
  };
}

export function isGoogleSignInConfigured(
  env: GoogleAuthEnv = process.env as unknown as GoogleAuthEnv
): boolean {
  return getGoogleSocialProviderConfig(env) !== null;
}
