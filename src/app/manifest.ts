import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VantixApp",
    short_name: "Vantix",
    description:
      "Gestión comercial, atención al cliente y automatización para negocios.",
    lang: "es-AR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Acompaña al tile del icono, así el splash no arranca en blanco.
    background_color: "#0d0f14",
    theme_color: "#3f6df2",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
