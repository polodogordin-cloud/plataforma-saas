import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MenuUnavailable } from "@/components/public/menu-unavailable";
import { PublicHeader } from "@/components/public/public-header";
import { PublicMenuView } from "@/components/public/public-menu";
import { ThemeScope } from "@/components/public/themed";
import {
  getPublicMenu,
  getPublicRestaurant,
  getPublicRestaurantState,
  listPublishedSlugs,
} from "@/lib/data/public-menu";
import { jsonForScript } from "@/lib/safe-html";
import { getPublicRestaurantTheme } from "@/lib/data/theme";
import { getPublicWhatsappConfig } from "@/lib/data/whatsapp";
import { WhatsappButton } from "@/components/public/whatsapp-button";
import { describeWeek, readOpeningHours } from "@/lib/opening-hours";
import { getRestaurantTimezone } from "@/lib/data/timezone";
import { metadataBaseUrl } from "@/lib/site";

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

/**
 * ─── Por que `generateStaticParams` existe aqui (Etapa 14) ────────────────
 *
 * Sem ele, `revalidate` **não tem efeito**: uma rota com parâmetro dinâmico que
 * não declara nenhum caminho não tem o que pré-renderizar, e o Next a trata
 * como dinâmica (`ƒ`) — HTML gerado a cada visita, uma consulta ao banco por
 * cliente. Foi medido: com esta função a rota passa a `●` (ISR), revalidando a
 * cada 60 s.
 *
 * É também o que torna o `createPublicClient` (cliente sem cookies) útil: ele
 * removeu o impedimento técnico, mas quem manda o Next pré-renderizar é esta
 * declaração.
 *
 * Lista os cardápios **publicados no momento do build**. Casa que publicar
 * depois entra na primeira visita (geração sob demanda) e passa a ser cacheada
 * igual. Casa despublicada sai do cache no próximo `revalidate`.
 *
 * Falha de banco aqui não derruba o build: sem lista, a rota volta a ser
 * dinâmica, que é o comportamento anterior — degradar é melhor que não subir.
 */
export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  try {
    const slugs = await listPublishedSlugs();
    return slugs.map((row) => ({ slug: row.slug }));
  } catch {
    return [];
  }
}

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

  /*
   * `title` curto porque o template do layout raiz já acrescenta "· Menuvo" —
   * repetir o nome da plataforma come o espaço que o nome do restaurante
   * precisa no resultado de busca, que é o que o cliente procura.
   */
  const title = `${restaurant.name} · Cardápio`;
  const description = buildDescription(restaurant);

  /*
   * ─── Por que `metadataBase` e não `headers()` ─────────────────────────
   *
   * `og:url` e `og:image` precisam de URL absoluta: quem lê essas tags é o
   * WhatsApp, o Instagram ou o Google, que não têm como resolver um caminho.
   *
   * O caminho óbvio seria ler o host da requisição com `headers()`. Foi o que
   * eu fiz primeiro — e o `npm run build` denunciou o custo: a rota passou a
   * `ƒ Dynamic`, e o cardápio perdeu o ISR. Em salão cheio, isso é uma
   * consulta ao banco por cliente em vez de uma por minuto.
   *
   * `metadataBase` resolve a mesma coisa **em tempo de build**, a partir de
   * `NEXT_PUBLIC_SITE_URL`, e o Next monta as URLs absolutas sozinho. Em
   * preview/staging a variável aponta para o domínio daquele ambiente.
   */
  const path = `/r/${restaurant.slug}`;

  /*
   * ─── Imagem de compartilhamento (Etapa 23) ───────────────────────────────
   *
   * A logo funciona como avatar, mas num card de WhatsApp ela é recortada em
   * quadrado e sobra pouco: o que aparece é uma marca pequena ao lado de três
   * linhas de texto. O `opengraph-image.tsx` desta rota gera a **arte 1200×630**
   * com o nome do restaurante em destaque e o endereço na base — é o que
   * transforma o link colado num card que as pessoas clicam.
   *
   * Declaramos a URL explicitamente (em vez de confiar na convenção de arquivo)
   * porque assim ela também é usada pelo `twitter:image`, e porque a arte é
   * servida pela nossa origem: a prévia não depende de o mensageiro conseguir
   * buscar uma imagem do bucket do Supabase (alguns buscam, o WhatsApp costuma
   * ignorar imagens de terceiros com cache curto).
   */
  const shareImage = {
    url: `${path}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: `Cardápio digital de ${restaurant.name}`,
  };

  return {
    metadataBase: metadataBaseUrl(),
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "Menuvo",
      locale: "pt_BR",
      title,
      description,
      url: path,
      images: [shareImage],
    },
    twitter: {
      // `summary_large_image` sempre: a arte é 16:9 e é ela que carrega o nome.
      card: "summary_large_image",
      title,
      description,
      images: [shareImage.url],
    },
    // Sem `robots` aqui: o cardápio publicado deve ser indexado (é o que traz
    // cliente novo pelo Google). Quem some do índice é o 404 e a página de
    // casa suspensa, tratados nos próprios arquivos.
  };
}

/**
 * Descrição para busca e compartilhamento.
 *
 * Sai de campos que o dono já publica (`description`, cidade). Nada de dado
 * interno: telefone de contato, plano, e-mail da conta ou id. O `description`
 * do restaurante é conteúdo público do cardápio — o que não é público é o
 * `settings`, que nunca é lido aqui.
 */
function buildDescription(restaurant: {
  name: string;
  description?: string | null;
  city?: string | null;
  state?: string | null;
  settings?: unknown;
}): string {
  /*
   * Etapa 23: a chamada que o dono edita em "Divulgar meu cardápio" entra aqui
   * primeiro. É o texto que ele escolheu para vender — usar a `description` do
   * restaurante (que é sobre o tipo de comida) quando ele escreveu uma chamada
   * seria ignorar a decisão dele.
   *
   * Vem de `settings.share_headline`, e não de uma coluna lida na view pública:
   * `settings` já viaja no cabeçalho do cardápio desde a Etapa 1, então não há
   * consulta nova nem mudança na view.
   */
  const headline = readShareHeadline(restaurant.settings);
  const base =
    headline?.trim() ||
    restaurant.description?.trim() ||
    `Veja o cardápio de ${restaurant.name} e escolha o que pedir.`;

  const where = [restaurant.city, restaurant.state].filter(Boolean).join(" · ");
  const suffix = where ? ` ${where}.` : "";

  // Meta description acima de ~160 caracteres é cortada no resultado de busca.
  const composed = `${base}${suffix}`;
  return composed.length > 160 ? `${composed.slice(0, 157).trimEnd()}…` : composed;
}

/**
 * Lê a chamada de divulgação de `settings`.
 *
 * Defensivo por necessidade: `settings` é `jsonb` livre, escrito por três
 * versões diferentes do app. Um valor que não seja string, ou que seja longo
 * demais, é ignorado em vez de irromper no `<meta>`.
 */
function readShareHeadline(settings: unknown): string | null {
  if (!settings || typeof settings !== "object") return null;
  const value = (settings as Record<string, unknown>).share_headline;
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 160) : null;
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
          // Etapa 20: `JSON.stringify` não escapa `<`, e `</script>` no nome do
          // restaurante encerraria o bloco — XSS armazenado servido pela nossa
          // origem. `jsonForScript` troca `<`/`>`/`&` por escapes Unicode, que
          // leem o mesmo dado e não fecham o elemento.
          __html: jsonForScript({
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
          }),
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
