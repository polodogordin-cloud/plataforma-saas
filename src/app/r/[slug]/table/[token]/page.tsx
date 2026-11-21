import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PublicHeader } from "@/components/public/public-header";
import { PublicMenuView } from "@/components/public/public-menu";
import { TableBadge } from "@/components/public/table-badge";
import { getPublicMenu, getPublicRestaurant } from "@/lib/data/public-menu";
import { resolveTableToken } from "@/lib/data/tables";
import { getRestaurantTimezone } from "@/lib/data/timezone";
import type { PublicRestaurant } from "@/lib/types";

type Params = { slug: string; token: string };

/**
 * Cardápio aberto por QR Code / NFC: /r/{slug}/table/{token}
 *
 * Regra central (item 6 do escopo): o cardápio NÃO é embutido na URL nem
 * copiado para a mesa. Resolvemos (restaurante, mesa) e renderizamos o
 * cardápio atual — por isso mudar preço, foto ou disponibilidade nunca exige
 * reimprimir um QR Code.
 *
 * A mesma URL serve para QR e para TAG NFC (Etapa 5): é só gravar esta string.
 * O middleware guarda o token na sessão do cliente para a Etapa 6.
 */
export const revalidate = 60;

export const metadata: Metadata = {
  // Mesa é contexto de salão, não conteúdo de busca.
  robots: { index: false, follow: false },
};

export default async function TableMenuPage({ params }: { params: Promise<Params> }) {
  const { slug, token } = await params;

  const [restaurant, context] = await Promise.all([
    getPublicRestaurant(slug),
    resolveTableToken(token),
  ]);

  // A RPC só devolve mesa de restaurante publicado e mesa ativa. Se não veio
  // nada, o slug pode ainda existir (restaurante pausado): mostramos o motivo
  // sem revelar se o token existe.
  if (!context) {
    // Slug existe mas a mesa não resolve: restaurante fechado/pausado ou mesa
    // desativada. Mostramos o motivo em vez de um 404 seco.
    if (restaurant) return <UnavailablePage restaurant={restaurant} />;
    notFound();
  }

  // Token válido, mas de outro restaurante: leva ao cardápio correto em vez de
  // exibir a mesa errada (isolamento entre tenants).
  if (!restaurant) notFound();
  if (context.restaurant_id !== restaurant.id) {
    redirect(`/r/${restaurant.slug}`);
  }

  const [menu, timeZone] = await Promise.all([
    getPublicMenu(restaurant.id),
    getRestaurantTimezone(restaurant.id),
  ]);

  return (
    <div className="min-h-dvh bg-ink-50">
      <PublicHeader
        restaurant={restaurant}
        menu={menu}
        timeZone={timeZone}
        tableName={context.table_name}
      />

      {/*
        Mesa vinda do QR/NFC: é a credencial do pedido. O token é revalidado no
        servidor a cada envio (`create_order`), então a sessão nunca é confiada
        só ao navegador.
      */}
      <PublicMenuView
        menu={menu}
        tableName={context.table_name}
        tableToken={token}
      />

      <footer className="border-t border-ink-200/70 bg-white pb-safe">
        <div className="mx-auto w-full max-w-lg px-4 py-5 text-center">
          <TableBadge name={context.table_name} />
          <p className="mt-3 text-xs text-ink-400">{restaurant.name} · cardápio digital</p>
        </div>
      </footer>
    </div>
  );
}

/**
 * Mesa desativada ou restaurante fora do ar.
 *
 * O cliente acabou de apontar a câmera para um QR na mesa; ele precisa saber o
 * que fazer, não ver um 404 seco. A mensagem não distingue "mesa desativada"
 * de "token inválido" — não vale entregar pistas.
 */
function UnavailablePage({ restaurant }: { restaurant: PublicRestaurant }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-ink-50 px-5 py-10">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-ink-200 bg-white p-6 text-center">
        <span
          className="mx-auto grid size-12 place-items-center rounded-2xl bg-amber-50 text-xl"
          aria-hidden="true"
        >
          🪑
        </span>
        <h1 className="mt-3 text-lg font-semibold text-ink-900">
          Esta mesa não está disponível
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          O cardápio de <strong>{restaurant.name}</strong> está fechado no momento ou
          esta mesa foi desativada. Chame um atendente — ele resolve rapidinho.
        </p>
      </div>
    </main>
  );
}
