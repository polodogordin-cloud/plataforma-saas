import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://menuvo.app").replace(/\/$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Área autenticada e fluxos de conta não têm valor em busca.
        disallow: ["/app", "/onboarding", "/auth", "/redefinir-senha", "/configuracoes"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
