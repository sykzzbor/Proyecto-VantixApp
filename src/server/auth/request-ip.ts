/**
 * Resolución de la IP del cliente detrás del proxy de Vercel.
 *
 * `x-forwarded-for` lo puede escribir cualquiera: si el cliente manda el suyo,
 * la cadena queda `<falso>, <real>`. Por eso se prueban primero las cabeceras
 * que escribe el propio proxy y se descarta cualquier valor con más de una IP,
 * que es justamente la señal de que alguien inyectó un salto.
 *
 * Sin IP confiable no se inventa una: el llamador decide (normalmente, aplicar
 * el límite igual con una clave compartida en vez de dejar pasar todo).
 */

/** En orden de confianza: las dos primeras las escribe la red de Vercel. */
export const TRUSTED_IP_HEADERS = [
  "x-vercel-forwarded-for",
  "x-real-ip",
  "x-forwarded-for",
] as const;

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

function isPlausibleIp(value: string): boolean {
  if (IPV4.test(value)) {
    return value.split(".").every((part) => {
      const octet = Number(part);
      return Number.isInteger(octet) && octet >= 0 && octet <= 255;
    });
  }
  return value.includes(":") && IPV6.test(value) && value.length <= 45;
}

/**
 * Colapsa IPv6 a su prefijo /64: un atacante con un bloque IPv6 entero tiene
 * billones de direcciones, y sin esto cada una sería un cupo nuevo.
 */
function normalizeIp(value: string): string {
  const ip = value.toLowerCase();
  if (!ip.includes(":")) return ip;
  const mapped = ip.startsWith("::ffff:") ? ip.slice(7) : null;
  if (mapped && IPV4.test(mapped)) return mapped;

  const [head] = ip.split("%"); // descarta el scope zone (fe80::1%eth0)
  const groups = (head ?? ip).split(":");
  return groups.slice(0, 4).join(":");
}

export function resolveClientIp(headers: Headers): string | null {
  for (const header of TRUSTED_IP_HEADERS) {
    const raw = headers.get(header);
    if (!raw) continue;

    const values = raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    // Más de una IP significa cadena reenviada: el extremo izquierdo lo
    // controla el cliente y no hay forma de saber cuál salto es real.
    if (values.length !== 1) continue;

    const candidate = values[0];
    if (candidate && isPlausibleIp(candidate)) return normalizeIp(candidate);
  }
  return null;
}

/**
 * Clave de rate limiting por IP. Sin IP confiable devuelve una clave compartida
 * para que el límite se aplique igual, en vez de convertirse en un bypass.
 */
export function clientIpKey(headers: Headers): string {
  return resolveClientIp(headers) ?? "ip-desconocida";
}
