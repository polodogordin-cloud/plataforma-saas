import { createClient } from "@/lib/supabase/server";
import type { Category, CategoryWithProducts, Product } from "@/lib/types";

/**
 * Cardápio completo do restaurante, já agrupado por categoria e ordenado.
 * A RLS garante que só retornam dados do tenant do usuário logado.
 */
export async function getMenu(restaurantId: string): Promise<{
  categories: Category[];
  products: Product[];
  menu: CategoryWithProducts[];
  uncategorized: Product[];
}> {
  const supabase = await createClient();

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase
      .from("categories")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("products")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  const categoryList = (categories ?? []) as Category[];
  // numeric vem como string do PostgREST: normaliza para número.
  const productList = ((products ?? []) as Product[]).map((product) => ({
    ...product,
    price: Number(product.price),
  }));

  const byCategory = new Map<string, Product[]>();
  const uncategorized: Product[] = [];

  for (const product of productList) {
    if (!product.category_id) {
      uncategorized.push(product);
      continue;
    }
    const bucket = byCategory.get(product.category_id) ?? [];
    bucket.push(product);
    byCategory.set(product.category_id, bucket);
  }

  const menu: CategoryWithProducts[] = categoryList.map((category) => ({
    ...category,
    products: byCategory.get(category.id) ?? [],
  }));

  return { categories: categoryList, products: productList, menu, uncategorized };
}

/** Lista enxuta de categorias para selects e filtros. */
export async function listCategories(restaurantId: string): Promise<Category[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("position", { ascending: true });
  return (data ?? []) as Category[];
}

/** Produto único (usado pela tela de edição). */
export async function getProduct(productId: string): Promise<Product | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("*").eq("id", productId).maybeSingle();
  if (!data) return null;
  return { ...(data as Product), price: Number((data as Product).price) };
}
