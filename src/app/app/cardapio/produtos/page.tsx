import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app/app-header";
import { ProductsBrowser } from "@/components/menu/products-browser";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getMenu } from "@/lib/data/menu";

export const metadata: Metadata = { title: "Produtos" };

export default async function ProductsPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const { menu, uncategorized } = await getMenu(restaurant.id);
  const canEdit = restaurant.role === "owner" || restaurant.role === "admin";

  const products = [
    ...menu.flatMap((category) =>
      category.products.map((product) => ({ product, categoryName: category.name })),
    ),
    ...uncategorized.map((product) => ({ product, categoryName: null })),
  ];

  return (
    <>
      <AppHeader
        title="Produtos"
        subtitle={restaurant.name}
        backHref="/app/cardapio"
      />
      <main className="app-shell px-4 pb-40 pt-4">
        <ProductsBrowser
          initialItems={products}
          categories={menu.map(({ products: _p, ...category }) => category)}
          canEdit={canEdit}
        />
      </main>
    </>
  );
}
