import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink, Package, ShieldAlert } from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { MenuManager } from "@/components/menu/menu-manager";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getMenu } from "@/lib/data/menu";

export const metadata: Metadata = { title: "Cardápio" };

export default async function MenuPage() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const { menu, uncategorized } = await getMenu(restaurant.id);
  const canEdit = restaurant.role === "owner" || restaurant.role === "admin";

  return (
    <>
      <AppHeader
        title="Cardápio"
        subtitle={restaurant.name}
        action={canEdit ? { href: "/app/cardapio/produtos", label: "Produtos" } : undefined}
      />

      <main className="app-shell px-4 pb-40 pt-4">
        {/* Como o cliente vê: atalho para o cardápio público real */}
        {restaurant.status === "published" ? (
          <Link
            href={`/r/${restaurant.slug}`}
            target="_blank"
            rel="noreferrer"
            className="mb-4 flex items-center gap-3 rounded-xl bg-brand-50 px-3.5 py-3 ring-1 ring-inset ring-brand-200/70 transition-colors active:bg-brand-100"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">
              <ExternalLink className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-brand-900">
                Ver como o cliente vê
              </span>
              <span className="block truncate font-mono text-xs text-brand-800/70">
                /r/{restaurant.slug}
              </span>
            </span>
          </Link>
        ) : (
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-amber-50 px-3.5 py-3 ring-1 ring-inset ring-amber-200">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-500 text-white">
              <ExternalLink className="size-4" aria-hidden="true" />
            </span>
            <p className="min-w-0 text-xs leading-relaxed text-amber-900">
              O cardápio público está <strong>desativado</strong>. Ative na tela inicial para
              liberar o link e o QR Code.
            </p>
          </div>
        )}

        {!canEdit && (
          <div className="mb-4 flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-inset ring-amber-200">
            <ShieldAlert className="mt-0.5 size-4.5 shrink-0 text-amber-600" aria-hidden="true" />
            <p className="text-sm leading-relaxed text-amber-800">
              Você está vendo o cardápio em modo leitura. Peça a um proprietário ou
              administrador para editar.
            </p>
          </div>
        )}

        <MenuManager
          initialMenu={menu}
          initialUncategorized={uncategorized}
          canEdit={canEdit}
        />

        {menu.length > 0 && (
          <p className="mt-6 text-center text-xs leading-relaxed text-ink-400">
            Toque e segure a alça{" "}
            <span aria-hidden="true" className="font-mono">
              ⠿
            </span>{" "}
            para reordenar. A ordem vale para o cardápio público.
          </p>
        )}

        <div className="mt-4 rounded-xl bg-ink-100/70 px-4 py-3">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-500">
            <Package className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
            <span>
              <Link href="/app/cardapio/produtos" className="font-semibold text-brand-700">
                Ver todos os produtos
              </Link>
              . Adicionais, tamanhos e combos chegam nas próximas etapas.
            </span>
          </p>
        </div>
      </main>
    </>
  );
}
