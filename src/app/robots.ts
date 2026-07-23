import type { MetadataRoute } from "next";
import {
  CANONICAL_APP_ORIGIN,
  canonicalPublicUrl,
} from "@/lib/public-domain";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/privacidad", "/soporte"],
      disallow: [
        "/api/",
        "/dashboard/",
        "/invitacion/",
        "/login",
        "/onboarding",
        "/recuperar-password",
        "/registro",
        "/restablecer-password",
      ],
    },
    sitemap: canonicalPublicUrl("/sitemap.xml"),
    host: CANONICAL_APP_ORIGIN,
  };
}
