import type { MetadataRoute } from "next";
import { listPublishedSlugs } from "@/lib/data/public-menu";

/**
 * Sitemap: só páginas públicas.
 *
 * `/r/{slug}` entra apenas para restaurantes publicados — e, como já são
 * URLs compartilhadas em QR Code e redes sociais, listá-las não revela nada
 * que o link não revele sozinho.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://menuvo.app").replace(/\/$/, "");

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/criar-conta`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/entrar`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${base}/recuperar-senha`, changeFrequency: "yearly", priority: 0.2 },
  ];

  try {
    const slugs = await listPublishedSlugs();
    const menus: MetadataRoute.Sitemap = slugs.map((row) => ({
      url: `${base}/r/${row.slug}`,
      changeFrequency: "daily",
      priority: 0.8,
    }));
    return [...staticRoutes, ...menus];
  } catch {
    // Banco indisponível: o sitemap estático é melhor que um 500.
    return staticRoutes;
  }
}
