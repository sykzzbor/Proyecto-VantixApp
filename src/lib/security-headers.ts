/**
 * Cabeceras de seguridad de la aplicación.
 *
 * Se definen acá, aparte de `next.config.ts`, para poder probarlas sin
 * levantar Next.
 *
 * La Content Security Policy es deliberadamente compatible con la app en vez
 * de máximamente estricta: Next inyecta scripts y estilos en línea para la
 * hidratación y Tailwind escribe estilos en línea, así que un `script-src`
 * sin `'unsafe-inline'` rompería el panel entero. Lo que sí se cierra es todo
 * lo que la app no necesita y es lo que un atacante aprovecharía: incrustarla
 * en un iframe, cambiar la URL base, mandar formularios a otro dominio o
 * cargar plugins.
 */

export type SecurityHeader = { key: string; value: string };

const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  // Next necesita inline para los datos de hidratación; `unsafe-eval` solo
  // hace falta en desarrollo (React Refresh).
  "script-src": ["'self'", "'unsafe-inline'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  // `data:` cubre los avatares que la app guarda como data URL; `https:`
  // permite las fotos de perfil de Google.
  "img-src": ["'self'", "data:", "https:", "blob:"],
  "font-src": ["'self'", "data:"],
  // Las llamadas salen del servidor, no del navegador: alcanza con 'self'.
  "connect-src": ["'self'"],
  // Mercado Pago abre el checkout en una pestaña nueva, no embebido.
  "frame-src": ["'none'"],
  // Nadie puede incrustar VantixApp: corta el clickjacking.
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  // Un formulario inyectado no puede mandar datos a otro dominio.
  "form-action": ["'self'"],
  "object-src": ["'none'"],
};

export function buildContentSecurityPolicy(options?: {
  development?: boolean;
}): string {
  const directives: Record<string, string[]> = Object.fromEntries(
    Object.entries(CSP_DIRECTIVES).map(([key, value]) => [key, [...value]])
  );

  if (options?.development) {
    // React Refresh y el overlay de errores de Turbopack usan eval y un
    // websocket contra el propio host.
    directives["script-src"]!.push("'unsafe-eval'");
    directives["connect-src"]!.push("ws:", "wss:");
  } else {
    // Solo en producción: fuerza que cualquier subrecurso viaje por HTTPS.
    directives["upgrade-insecure-requests"] = [];
  }

  return Object.entries(directives)
    .map(([key, values]) => (values.length ? `${key} ${values.join(" ")}` : key))
    .join("; ");
}

export function getSecurityHeaders(options?: {
  development?: boolean;
}): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy(options),
    },
    // Redundante con `frame-ancestors` pero lo entienden navegadores viejos.
    { key: "X-Frame-Options", value: "DENY" },
    // Evita que un archivo subido se interprete como otro tipo.
    { key: "X-Content-Type-Options", value: "nosniff" },
    // No filtra la ruta completa —que puede llevar ids— a sitios externos.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: [
        "camera=()",
        "microphone=()",
        "geolocation=()",
        "payment=()",
        "usb=()",
        "interest-cohort=()",
      ].join(", "),
    },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ];

  if (!options?.development) {
    headers.push({
      // Dos años, subdominios incluidos. Solo en producción: en desarrollo
      // se sirve por HTTP y fijaría el navegador a HTTPS en localhost.
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}
