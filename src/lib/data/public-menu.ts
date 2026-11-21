import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import type {
  PublicCategory,
  PublicMenu,
  PublicMenuSection,
  PublicProduct,
  PublicRestaurant,
} from "@/lib/types";

/**
 * Leitura do cardápio público.
 *
 * Usa apenas as views `public_*`, que já filtram:
 *   - restaurante com status 'published'
 *   - categoria ativa
 *   - produto disponível e em categoria ativa
 *
 * Nenhuma dessas consultas exige sessão: é o que permite o cliente abrir o
 * cardápio sem criar conta. A RLS continua valendo para o painel.
 */

/** Normaliza o slug da URL (minúsculo, sem barras sobrando). */
export function normalizeSlug(value: string): string {
  return decodeURIComponent(value).trim().toLowerCase();
}

/**
 * Restaurante publicado pelo slug. `cache` evita repetir a consulta entre
 * `generateMetadata` e a página na mesma requisição.
 */
export const getPublicRestaurant = cache(
  async (slug: string): Promise<PublicRestaurant | null> => {
    if (!slug) return null;
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("public_restaurants")
      .select("id, name, slug, logo_url, description, city, state, currency, status, settings")
      .eq("slug", normalizeSlug(slug))
      .maybeSingle();

    if (error || !data) return null;
    return data as PublicRestaurant;
  },
);

/**
 * Estado de um slug para a mensagem pública — Etapa 10.
 *
 * `getPublicRestaurant` devolve `null` tanto para "não existe" quanto para
 * "existe, mas suspenso/pausado", e a página precisa distinguir os dois para
 * não mostrar um 404 seco a quem escaneou o QR de uma casa suspensa.
 *
 * A RPC devolve **apenas o status**: nada de telefone, equipe ou configurações.
 * `null` significa "não existe" e continua virando 404.
 */
export const getPublicRestaurantState = cache(async (slug: string): Promise<string | null> => {
  if (!slug) return null;
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("public_restaurant_state", {
    p_slug: normalizeSlug(slug),
  });
  if (error) return null;
  return (data as string | null) ?? null;
});

/**
 * Cardápio agrupado por categoria, na ordem definida pelo restaurante.
 *
 * Produtos sem categoria não aparecem: a view pública exige `category_id`.
 * Categorias sem produtos ficam de fora (não faz sentido abrir uma seção vazia).
 */
export const getPublicMenu = cache(async (restaurantId: string): Promise<PublicMenu> => {
  const supabase = createPublicClient();

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase
      .from("public_categories")
      .select("id, restaurant_id, name, description, image_url, position")
      .eq("restaurant_id", restaurantId)
      .order("position", { ascending: true }),
    supabase
      .from("public_products")
      .select("id, restaurant_id, category_id, name, description, price, image_url, is_featured, position")
      .eq("restaurant_id", restaurantId)
      .order("position", { ascending: true }),
  ]);

  const categoryList = (categories ?? []) as PublicCategory[];
  // PostgREST devolve numeric como string.
  const productList = ((products ?? []) as unknown as PublicProduct[]).map((product) => ({
    ...product,
    price: Number(product.price),
  }));

  const byCategory = new Map<string, PublicProduct[]>();
  for (const product of productList) {
    const bucket = byCategory.get(product.category_id) ?? [];
    bucket.push(product);
    byCategory.set(product.category_id, bucket);
  }

  const sections: PublicMenuSection[] = categoryList
    .map((category) => ({ ...category, products: byCategory.get(category.id) ?? [] }))
    .filter((section) => section.products.length > 0);

  // Destaques: primeiro os marcados, depois os mais caros como reserva visual.
  const featured = productList.filter((product) => product.is_featured).slice(0, 8);

  return {
    sections,
    featured,
    counts: {
      categories: sections.length,
      products: productList.length,
    },
  };
});

/**
 * Lista enxuta dos slugs publicados — usada no `sitemap` e para decidir o
 * "não encontrado" sem expor nada além de nomes de caminhos que já são públicos.
 */
export async function listPublishedSlugs(): Promise<
  Array<{ slug: string; updated_at: string | null }>
> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("public_restaurants")
    .select("slug")
    .order("slug", { ascending: true })
    .limit(5000);

  return ((data ?? []) as Array<{ slug: string }>).map((row) => ({
    slug: row.slug,
    updated_at: null,
  }));
}
