import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MenuUnavailable } from "@/components/public/menu-unavailable";
import { PublicHeader } from "@/components/public/public-header";
import { PublicMenuView } from "@/components/public/public-menu";
import { ThemeScope } from "@/components/public/themed";
import { getPublicMenu, getPublicRestaurant, getPublicRestaurantState } from "@/lib/data/public-menu";
import { getPublicRestaurantTheme } from "@/lib/data/theme";
import { getPublicWhatsappConfig } from "@/lib/data/whatsapp";
import { WhatsappButton } from "@/components/public/whatsapp-button";
import { describeWeek, readOpeningHours } from "@/lib/opening-hours";
import { getRestaurantTimezone } from "@/lib/data/timezone";

type Params = { slug: string };

/**
 * Cardápio público: /r/{slug}
 *
 * Sem login, sem cookie obrigatório. Renderizado no servidor para que o
 * cliente veja o conteúdo no primeiro paint (importante em 3G no salão).
 *
 * Revalida a cada minuto: mudanças de preço/disponibilidade aparecem rápido
 * sem custar uma consulta por visitante.
 */
export const revalidate = 60;

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

  const title = `${restaurant.name} · Cardápio`;
  const description =
    restaurant.description ??
    `Veja o cardápio de ${restaurant.name} e escolha o que pedir.`;

  return {
    title,
    description,
    alternates: { canonical: `/r/${restaurant.slug}` },
    openGraph: {
      type: "website",
      title,
      description,
      url: `/r/${restaurant.slug}`,
      images: restaurant.logo_url ? [{ url: restaurant.logo_url }] : undefined,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicMenuPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const restaurant = await getPublicRestaurant(slug);

  if (!restaurant) {
    // Etapa 10: distinguir "nunca existiu" de "existe, mas suspenso/pausado".
    // Só o status sai daqui — nenhum outro dado do restaurante é exposto.
    const state = await getPublicRestaurantState(slug);
    if (state === "suspended") return <MenuUnavailable reason="suspended" />;
    if (state) return <MenuUnavailable reason="unpublished" />;
    notFound();
  }

  const [menu, timeZone, theme, whatsapp] = await Promise.all([
    getPublicMenu(restaurant.id),
    getRestaurantTimezone(restaurant.id),
    // Tema da casa (Etapa 9). Falha aqui não derruba o cardápio: a leitura cai
    // no tema padrão, que é o fallback do item 10 do escopo.
    getPublicRestaurantTheme(restaurant.id),
    // WhatsApp (Etapa 13). A RPC já devolve `null` quando o canal está
    // desligado, sem número ou fora do plano — aqui só se renderiza o que veio.
    getPublicWhatsappConfig(restaurant.slug),
  ]);

  const hours = readOpeningHours(restaurant.settings);
  const week = hours ? describeWeek(hours) : [];

  return (
    <ThemeScope theme={theme} className="min-h-dvh">
      {/* Dados estruturados: ajuda o Google a mostrar nome/horário. */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Restaurant",
            name: restaurant.name,
            description: restaurant.description ?? undefined,
            image: restaurant.logo_url ?? undefined,
            servesCuisine: undefined,
            address: restaurant.city
              ? {
                  "@type": "PostalAddress",
                  addressLocality: restaurant.city,
                  addressRegion: restaurant.state ?? undefined,
                  addressCountry: "BR",
                }
              : undefined,
            hasMenu: {
              "@type": "Menu",
              hasMenuSection: menu.sections.map((section) => ({
                "@type": "MenuSection",
                name: section.name,
                hasMenuItem: section.products.map((product) => ({
                  "@type": "MenuItem",
                  name: product.name,
                  description: product.description ?? undefined,
                  image: product.image_url ?? undefined,
                  offers: {
                    "@type": "Offer",
                    price: product.price.toFixed(2),
                    priceCurrency: restaurant.currency || "BRL",
                  },
                })),
              })),
            },
          })
            .replace(/</g, "\\u003c")
            .replace(/>/g, "\\u003e"),
        }}
      />

      <PublicHeader
        restaurant={restaurant}
        menu={menu}
        timeZone={timeZone}
        theme={theme}
      />

      <PublicMenuView menu={menu} theme={theme} />

      {/* Rodapé: identidade + horários, sem virar tela de configurações */}
      <footer className="border-t border-[var(--mv-border)] bg-[var(--mv-surface)] pb-safe">
        <div className="mx-auto w-full max-w-lg px-4 py-6">
          {week.length > 0 && (
            <>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--mv-text-muted)]">
                Horários
              </h2>
              <dl className="mt-2 space-y-1">
                {week.map((day) => (
                  <div key={day.day} className="flex items-baseline justify-between gap-4">
                    <dt className="text-sm capitalize text-[var(--mv-text-muted)]">{day.label}</dt>
                    <dd
                      className={
                        day.text === "Fechado"
                          ? "text-sm text-[var(--mv-text-muted)]"
                          : "text-sm font-medium tabular-nums text-[var(--mv-text)]"
                      }
                    >
                      {day.text}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {/*
            WhatsApp (Etapa 13): depois do cardápio e dos horários, antes da
            assinatura da plataforma. Fica no rodapé no cardápio sem mesa — quem
            está escolhendo, não quem já sentou — e é o último caminho quando o
            cardápio não atende (fechado, sem produto, precisa de informação).
          */}
          <div className="mt-6 pb-1">
            <WhatsappButton
              config={whatsapp}
              restaurantName={restaurant.name}
              theme={theme}
            />
          </div>

          <p className="mt-6 flex flex-wrap items-center justify-center gap-1.5 text-center text-xs text-[var(--mv-text-muted)]">
            <span>{restaurant.name}</span>
            <span aria-hidden="true">·</span>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center px-1 font-semibold text-[var(--mv-primary)] underline-offset-2 hover:underline"
            >
              cardápio feito com Menuvo
            </Link>
          </p>
        </div>
      </footer>
    </ThemeScope>
  );
}
