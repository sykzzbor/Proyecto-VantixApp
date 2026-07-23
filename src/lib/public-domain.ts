export const CANONICAL_APP_ORIGIN = "https://vantixapp.com.ar";
export const WWW_APP_ORIGIN = "https://www.vantixapp.com.ar";
export const LEGACY_APP_ORIGIN = "https://proyecto-vantix-app.vercel.app";

const CANONICALIZED_ORIGINS = new Set([
  WWW_APP_ORIGIN,
  LEGACY_APP_ORIGIN,
]);

export function normalizePublicOrigin(
  value: string | null | undefined
): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const origin = new URL(candidate).origin;
    return CANONICALIZED_ORIGINS.has(origin)
      ? CANONICAL_APP_ORIGIN
      : origin;
  } catch {
    return null;
  }
}

export function canonicalPublicUrl(path = "/"): string {
  return new URL(path, CANONICAL_APP_ORIGIN).toString();
}

export function getCanonicalHostRedirects() {
  return [WWW_APP_ORIGIN, LEGACY_APP_ORIGIN].map((origin) => ({
    source: "/:path*",
    has: [{ type: "host" as const, value: new URL(origin).host }],
    destination: `${CANONICAL_APP_ORIGIN}/:path*`,
    permanent: true,
  }));
}
