/**
 * Presentación de las sesiones activas.
 *
 * Todo lo que se muestra sale de lo que ya guarda Better Auth (`userAgent` e
 * `ipAddress`). El user agent se resume a "navegador · sistema" y la IP se
 * recorta antes de salir del servidor: alcanza para que alguien reconozca
 * "esa fui yo desde casa" sin exponer la dirección completa en el HTML.
 */

export type SessionSummary = {
  id: string;
  /** `true` para la sesión desde la que se está mirando la pantalla. */
  current: boolean;
  browser: string;
  os: string;
  deviceLabel: string;
  /** IP recortada: `181.44.x.x`. `null` si no se registró. */
  approximateIp: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
};

const BROWSERS: [RegExp, string][] = [
  // El orden importa: Edge y Opera también dicen "Chrome" en su user agent.
  [/edg[ea]?\//i, "Edge"],
  [/opr\/|opera/i, "Opera"],
  [/firefox\//i, "Firefox"],
  [/chrome\/|crios\//i, "Chrome"],
  [/safari\//i, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iphone|ipad|ipod/i, "iOS"],
  [/android/i, "Android"],
  [/mac os x|macintosh/i, "macOS"],
  [/windows/i, "Windows"],
  [/cros/i, "ChromeOS"],
  [/linux/i, "Linux"],
];

export function describeBrowser(userAgent: string | null): string {
  if (!userAgent) return "Navegador desconocido";
  for (const [pattern, name] of BROWSERS) {
    if (pattern.test(userAgent)) return name;
  }
  return "Navegador desconocido";
}

export function describeOs(userAgent: string | null): string {
  if (!userAgent) return "Sistema desconocido";
  for (const [pattern, name] of SYSTEMS) {
    if (pattern.test(userAgent)) return name;
  }
  return "Sistema desconocido";
}

/**
 * Recorta la IP para no mostrarla entera.
 * IPv4 conserva los dos primeros octetos; IPv6, los dos primeros grupos.
 */
export function maskIp(ip: string | null): string | null {
  const value = ip?.trim();
  if (!value) return null;

  if (value.includes(":")) {
    const groups = value.split(":").filter(Boolean);
    if (groups.length < 2) return null;
    return `${groups[0]}:${groups[1]}:x:x`;
  }

  const octets = value.split(".");
  if (octets.length !== 4) return null;
  return `${octets[0]}.${octets[1]}.x.x`;
}

export type RawSession = {
  id: string;
  token: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
};

/**
 * Arma la lista para la pantalla. `currentToken` nunca se devuelve: solo se
 * usa para marcar cuál es la sesión actual.
 */
export function summarizeSessions(
  sessions: RawSession[],
  currentToken: string
): SessionSummary[] {
  return sessions
    .map((session) => {
      const browser = describeBrowser(session.userAgent);
      const os = describeOs(session.userAgent);
      return {
        id: session.id,
        current: session.token === currentToken,
        browser,
        os,
        deviceLabel:
          browser === "Navegador desconocido" && os === "Sistema desconocido"
            ? "Dispositivo desconocido"
            : `${browser} · ${os}`,
        approximateIp: maskIp(session.ipAddress),
        createdAt: session.createdAt.toISOString(),
        lastActiveAt: session.updatedAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      } satisfies SessionSummary;
    })
    .sort((a, b) => {
      // La sesión actual primero; el resto por actividad más reciente.
      if (a.current !== b.current) return a.current ? -1 : 1;
      return b.lastActiveAt.localeCompare(a.lastActiveAt);
    });
}
