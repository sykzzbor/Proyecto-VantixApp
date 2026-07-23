import type { NextConfig } from "next";
import { getCanonicalHostRedirects } from "./src/lib/public-domain";

const nextConfig: NextConfig = {
  // Fija la raíz del proyecto para que Turbopack no la infiera mal
  // si existen lockfiles en carpetas superiores.
  turbopack: {
    root: import.meta.dirname,
  },
  async redirects() {
    return getCanonicalHostRedirects();
  },
};

export default nextConfig;
