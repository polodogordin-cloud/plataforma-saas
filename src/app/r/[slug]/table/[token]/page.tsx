import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PublicHeader } from "@/components/public/public-header";
import { PublicMenuView } from "@/components/public/public-menu";
import { TableBadge } from "@/components/public/table-badge";
import { ThemeScope } from "@/components/public/themed";
import { getPublicMenu, getPublicRestaurant } from "@/lib/data/public-menu";
import { getPublicRestaurantState } from "@/lib/data/public-menu";
import { MenuUnavailable } from "@/components/public/menu-unavailable";
import { getPublicRestaurantTheme } from "@/lib/data/theme";
import { getPublicWhatsappConfig } from "@/lib/data/whatsapp";
import { WhatsappButton } from "@/components/public/whatsapp-button";
import { resolveTableToken } from "@/lib/data/tables";
import { getRestaurantTimezone } from "@/lib/data/timezone";
import type { PublicRestaurant } from "@/lib/types";
import { metadataBaseUrl } from "@/lib/site";

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

/**
 * Metadados da mesa.
 *
 * `robots: noindex` continua — mesa é contexto de salão, e um cardápio de mesa
 * não deve competir com o do restaurante na busca.
 *
 * Mas **Open Graph** existe (Etapa 23): o link da mesa é compartilhado de verdade
 * (o garçom manda no direct, o cliente repassa para o grupo). Sem `og:*`, esse
 * link aparecia no WhatsApp como uma URL crua — e o dono ficava com a impressão
 * de que o compartilhamento não funciona.
 *
 * A imagem vem da rota `opengraph-image` do segmento pai (`/r/[slug]`), que o
 * Next herda automaticamente — por isso não a declaramos aqui.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await getPublicRestaurant(slug);

  if (!restaurant) {
    return {
      title: "Cardápio não encontrado",
      robots: { index: false, follow: false },
    };
  }

  const description =
    restaurant.description?.trim() ||
    `Veja o cardápio de ${restaurant.name} e escolha o que pedir.`;

  return {
    metadataBase: metadataBaseUrl(),
    title: `${restaurant.name} · Cardápio`,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: "Menuvo",
      locale: "pt_BR",
      title: `${restaurant.name} · Cardápio`,
      description,
      url: `/r/${restaurant.slug}/table`,
    },
    twitter: {
      card: "summary_large_image",
      title: `${restaurant.name} · Cardápio`,
      description,
    },
  };
}

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
    if (restaurant) return <MenuUnavailable reason="table" restaurantName={restaurant.name} />;

    // Etapa 10: o slug pode existir e estar suspenso. Nesse caso a mensagem é
    // outra — o cliente não está numa mesa inválida, a casa está bloqueada.
    const state = await getPublicRestaurantState(slug);
    if (state === "suspended") {
      return <MenuUnavailable reason="suspended" />;
    }
    notFound();
  }

  // Token válido, mas de outro restaurante: leva ao cardápio correto em vez de
  // exibir a mesa errada (isolamento entre tenants).
  if (!restaurant) notFound();
  if (context.restaurant_id !== restaurant.id) {
    redirect(`/r/${restaurant.slug}`);
  }

  const [menu, timeZone, theme, whatsapp] = await Promise.all([
    getPublicMenu(restaurant.id),
    getRestaurantTimezone(restaurant.id),
    getPublicRestaurantTheme(restaurant.id),
    // WhatsApp (Etapa 13): canal alternativo quando o cliente prefere falar
    // com uma pessoa em vez de montar o pedido no app.
    getPublicWhatsappConfig(restaurant.slug),
  ]);

  return (
    <ThemeScope theme={theme} className="min-h-dvh">
      <PublicHeader
        restaurant={restaurant}
        menu={menu}
        timeZone={timeZone}
        tableName={context.table_name}
        theme={theme}
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
        theme={theme}
      />

      {/*
        A barra de ações (Garçom · Carrinho · Conta) é fixa no rodapé, então o
        conteúdo da página precisa de folga para o botão de WhatsApp não nascer
        atrás dela. A folga acompanha a altura da barra + a área segura do
        iPhone: 5.5rem cobre a barra com o rótulo de duas linhas.
      */}
      <footer className="border-t border-[var(--mv-border)] bg-[var(--mv-surface)] pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg px-4 py-5 text-center">
          {whatsapp && (
            <div className="mb-5">
              <WhatsappButton
                config={whatsapp}
                restaurantName={restaurant.name}
                theme={theme}
              />
            </div>
          )}

          <TableBadge name={context.table_name} />
          <p className="mt-3 text-xs text-[var(--mv-text-muted)]">
            {restaurant.name} · cardápio digital
          </p>
        </div>
      </footer>
    </ThemeScope>
  );
}
