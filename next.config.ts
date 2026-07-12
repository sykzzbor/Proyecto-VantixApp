import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fija la raíz del proyecto para que Turbopack no la infiera mal
  // si existen lockfiles en carpetas superiores.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
