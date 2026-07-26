import type { NextConfig } from "next";
import { getCanonicalHostRedirects } from "./src/lib/public-domain";
import { getSecurityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Fija la raíz del proyecto para que Turbopack no la infiera mal
  // si existen lockfiles en carpetas superiores.
  turbopack: {
    root: import.meta.dirname,
  },
  async redirects() {
    return getCanonicalHostRedirects();
  },
  async headers() {
    const development = process.env.NODE_ENV === "development";
    return [
      {
        // Todas las rutas, incluidas las de API y los archivos estáticos.
        source: "/:path*",
        headers: getSecurityHeaders({ development }),
      },
    ];
  },
};

export default nextConfig;
