import type { MetadataRoute } from "next";
import { canonicalPublicUrl } from "@/lib/public-domain";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: canonicalPublicUrl("/privacidad"),
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: canonicalPublicUrl("/soporte"),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
