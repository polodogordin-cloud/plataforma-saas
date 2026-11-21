import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/app-header";
import { ThemeEditor } from "@/components/theme/theme-editor";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getRestaurantTheme } from "@/lib/data/theme";
import { getPublicMenu } from "@/lib/data/public-menu";
import { formatPrice } from "@/lib/validation";

export const metadata: Metadata = { title: "Personalizar cardápio" };

/**
 * Personalização do cardápio — Etapa 9.
 *
 * A tela é do restaurante ativo, resolvido no servidor: não existe parâmetro de
 * restaurante na URL, então abrir "/personalizacao" nunca edita a casa de
 * outra pessoa.
 *
 * O preview vem com **itens de exemplo reais** (os primeiros produtos do
 * cardápio) quando existem; sem cardápio montado, usa nomes genéricos para o
 * dono não ver um retângulo vazio.
 */
export default async function PersonalizationPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const [theme, menu] = await Promise.all([
    getRestaurantTheme(restaurant.id),
    getPublicMenu(restaurant.id),
  ]);

  const featured = menu.featured.length > 0 ? menu.featured : menu.sections.flatMap((s) => s.products);

  const sampleItems =
    featured.length > 0
      ? featured.slice(0, 3).map((product) => ({
          name: product.name,
          price: formatPrice(product.price),
        }))
      : [
          { name: "X-Bacon", price: formatPrice(29.9) },
          { name: "X-Salada", price: formatPrice(24.9) },
          { name: "Batata frita", price: formatPrice(18.9) },
        ];

  return (
    <>
      <AppHeader title="Personalizar cardápio" subtitle={restaurant.name} />

      <main className="app-shell px-4 pb-6 pt-4">
        <ThemeEditor
          restaurantId={restaurant.id}
          restaurantName={restaurant.name}
          tagline={restaurant.description}
          initialTheme={theme}
          sampleItems={sampleItems}
          isPublished={restaurant.status === "published"}
          slug={restaurant.slug}
        />
      </main>
    </>
  );
}
