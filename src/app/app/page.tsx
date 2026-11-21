import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BellRing,
  BookOpenText,
  ExternalLink,
  ClipboardList,
  LayoutGrid,
  Package,
  Palette,
  ShieldCheck,
  Plus,
  Store,
  UtensilsCrossed,
  ChartNoAxesColumn,
} from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { OrderBoardCards } from "@/components/orders/order-board-cards";
import { StatCard } from "@/components/app/stat-card";
import { StatusToggle } from "@/components/app/status-toggle";
import { PublicLink } from "@/components/app/public-link";
import { Badge, Card, SectionTitle } from "@/components/ui/card";
import {
  getActiveRestaurant,
  getProfile,
  getRestaurantCounters,
  getSessionUser,
} from "@/lib/data/restaurants";
import { getOrderBoardCounts } from "@/lib/data/orders-panel";
import { isPlatformAdmin } from "@/lib/data/admin";
import { tableRequestCounts } from "@/lib/data/table-requests";
import { RESTAURANT_ROLE_LABEL } from "@/lib/types";
import { firstName } from "@/lib/utils";

export const metadata: Metadata = { title: "Início" };

const quickActions = [
  {
    href: "/app/cardapio",
    label: "Editar cardápio",
    description: "Categorias e produtos",
    icon: BookOpenText,
    primary: true,
  },
  {
    href: "/app/mesas",
    label: "Mesas e QR Codes",
    description: "Organize o salão",
    icon: UtensilsCrossed,
    primary: false,
  },
  {
    href: "/app/configuracoes/personalizacao",
    label: "Personalizar cardápio",
    description: "Cores, capa e estilo",
    icon: Palette,
    primary: false,
  },
  {
    href: "/app/configuracoes/restaurante",
    label: "Dados do restaurante",
    description: "Nome, logo, endereço",
    icon: Store,
    primary: false,
  },
  // Etapa 16: relatórios. Fica também no acesso rápido (além da aba
  // "Relatórios" da navegação) porque é a tela que o dono abre no fim do dia,
  // quando entra pelo dashboard em vez de pela barra.
  {
    href: "/app/analytics",
    label: "Relatórios",
    description: "Vendas, produtos e horários",
    icon: ChartNoAxesColumn,
    primary: false,
  },
] as const;

/**
 * Avisos que chegam por querystring de outros pontos do app.
 *
 * Existem para o redirecionamento **não** ser silencioso. Quem tentou abrir
 * `/kitchen` sem permissão e volta para cá precisa entender por quê — um
 * retorno mudo parece bug e vira chamado de suporte.
 */
const AVISOS: Record<string, string> = {
  "sem-acesso-cozinha":
    "Sua conta não tem acesso ao painel da cozinha. Peça ao administrador do restaurante para ajustar seu perfil.",
  "casa-suspensa":
    "O restaurante está suspenso. Fale com o suporte da plataforma para reativar.",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/entrar?next=/app");

  const restaurant = await getActiveRestaurant();
  if (!restaurant) redirect("/onboarding");

  const { aviso } = await searchParams;
  const avisoTexto = aviso ? AVISOS[aviso] : undefined;

  const [profile, counters, orderCounts, requestCounts, isAdmin] = await Promise.all([
    getProfile(user.id),
    getRestaurantCounters(restaurant.id),
    // Etapa 7: os três números do salão, numa RPC só.
    getOrderBoardCounts(restaurant.id),
    // Etapa 8: gente esperando atenção na mesa.
    tableRequestCounts(restaurant.id),
    // Etapa 10: atalho para o painel master, quando o usuário tem o papel.
    isPlatformAdmin(),
  ]);

  const awaitingAttention = requestCounts.pending + requestCounts.acknowledged;

  const actions = isAdmin
    ? [
        ...quickActions,
        {
          href: "/admin",
          label: "Painel da plataforma",
          description: "Todas as casas e usuários",
          icon: ShieldCheck,
          primary: false,
        },
      ]
    : quickActions;

  const greetingName = firstName(profile?.full_name) || "chef";
  const hasMenu = counters.categories > 0 || counters.products > 0;

  return (
    <>
      <AppHeader
        title={restaurant.name}
        subtitle={RESTAURANT_ROLE_LABEL[restaurant.role]}
        showLogo
      />

      <main className="app-shell space-y-5 px-4 pb-6 pt-5">
        {avisoTexto && (
          <p
            role="alert"
            className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900"
          >
            {avisoTexto}
          </p>
        )}

        {/* Saudação + status */}
        <section className="animate-fade-in">
          <p className="text-sm text-ink-500">Olá, {greetingName} 👋</p>
          <h1 className="mt-0.5 text-[1.45rem] leading-tight font-semibold tracking-tight text-ink-900">
            {hasMenu ? "Seu restaurante está pronto para receber pedidos" : "Vamos montar seu cardápio"}
          </h1>
        </section>

        {/* Cartão do restaurante */}
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-3.5 p-4">
            <div className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 text-lg font-semibold text-white">
              {restaurant.logo_url ? (
                <Image
                  src={restaurant.logo_url}
                  alt={`Logo de ${restaurant.name}`}
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              ) : (
                restaurant.name.slice(0, 1).toUpperCase()
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink-900">{restaurant.name}</p>
              <p className="truncate text-sm text-ink-500">
                {restaurant.city
                  ? `${restaurant.city}${restaurant.state ? ` · ${restaurant.state}` : ""}`
                  : "Endereço não informado"}
              </p>
              <Link
                href={`/r/${restaurant.slug}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-brand-700"
              >
                <span className="truncate">/r/{restaurant.slug}</span>
                <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="border-t border-ink-100 px-4 py-3">
            <StatusToggle status={restaurant.status} />
          </div>
        </Card>

        {/* Cardápio público: o que o cliente vê e como compartilhar */}
        <PublicLink slug={restaurant.slug} status={restaurant.status} />

        {/* Etapa 8: alguém na mesa está esperando. Vem antes dos pedidos
            porque o cliente que levantou a mão está olhando para o salão. */}
        {awaitingAttention > 0 && (
          <Link
            href="/app/pedidos"
            className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5 transition-transform active:scale-[0.99]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-100 text-red-700">
              <BellRing className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-red-800">
                🔴 {awaitingAttention}{" "}
                {awaitingAttention === 1
                  ? "solicitação pendente"
                  : "solicitações pendentes"}
              </span>
              <span className="block text-xs text-red-700/80">
                {requestCounts.bills > 0
                  ? `${requestCounts.bills} ${requestCounts.bills === 1 ? "mesa pediu" : "mesas pediram"} a conta`
                  : "Garçom chamado na mesa"}
              </span>
            </span>
            <ArrowRight className="size-5 shrink-0 text-red-700" aria-hidden="true" />
          </Link>
        )}

        {/* Etapa 7: pedidos em destaque, com atalho para cada aba do painel */}
        <OrderBoardCards counts={orderCounts} />

        {/* Resumos */}
        <section aria-labelledby="resumo">
          <h2 id="resumo" className="sr-only">
            Resumo do restaurante
          </h2>
          <div className="stagger grid grid-cols-2 gap-3">
            <StatCard
              label="Produtos"
              value={counters.products}
              icon={Package}
              href="/app/cardapio"
              tone="brand"
            />
            <StatCard
              label="Categorias"
              value={counters.categories}
              icon={LayoutGrid}
              href="/app/cardapio"
              tone="sky"
            />
            <StatCard
              label="Mesas"
              value={counters.tables}
              icon={UtensilsCrossed}
              href="/app/mesas"
              tone="neutral"
            />
            <StatCard
              label="Pedidos ativos"
              value={counters.pendingOrders}
              icon={ClipboardList}
              href="/app/pedidos"
              tone="amber"
            />
          </div>
        </section>

        {/* Acesso rápido */}
        <section aria-labelledby="atalhos">
          <SectionTitle
            title="Acesso rápido"
            action={
              <Link
                href="/app/cardapio"
                className="tap-target -my-1 inline-flex items-center gap-1 py-1 text-sm font-semibold text-brand-700 hover:text-brand-800"
              >
                Ver tudo
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            }
          />
          <ul className="stagger space-y-2.5">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <li key={action.href}>
                  <Link
                    href={action.href}
                    className="card flex items-center gap-3.5 p-3.5 transition-all duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] active:scale-[0.99]"
                  >
                    <span
                      className={
                        action.primary
                          ? "grid size-11 shrink-0 place-items-center rounded-xl bg-brand-600 text-white"
                          : "grid size-11 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600"
                      }
                    >
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.95rem] font-semibold text-ink-900">
                        {action.label}
                      </span>
                      <span className="block truncate text-xs text-ink-500">
                        {action.description}
                      </span>
                    </span>
                    <ArrowRight className="size-4.5 shrink-0 text-ink-300" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Checklist de primeiros passos: orienta quem acabou de entrar */}
        {!hasMenu && (
          <section aria-labelledby="primeiros-passos">
            <SectionTitle
              title="Primeiros passos"
              description="Complete para publicar seu cardápio."
            />
            <Card className="space-y-3">
              <Step done label="Conta criada" />
              <Step done label="Restaurante cadastrado" />
              <Step label="Criar primeira categoria" />
              <Step label="Adicionar produtos" />
              <Step label="Publicar o cardápio" />
              <Link
                href="/app/cardapio"
                className="tap-target mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700 active:scale-[0.99]"
              >
                <Plus className="size-4" aria-hidden="true" />
                Começar pelo cardápio
              </Link>
            </Card>
          </section>
        )}

        <p className="pb-2 text-center text-xs leading-relaxed text-ink-400">
          Cardápio, mesas e pedidos em produção.
        </p>
      </main>
    </>
  );
}

function Step({ done = false, label }: { done?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={
          done
            ? "grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-white"
            : "grid size-6 shrink-0 place-items-center rounded-full border-2 border-dashed border-ink-300"
        }
        aria-hidden="true"
      >
        {done && (
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3.5">
            <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span
        className={done ? "text-sm text-ink-400 line-through" : "text-sm font-medium text-ink-700"}
      >
        {label}
      </span>
      {done ? (
        <Badge tone="success" className="ml-auto">
          Feito
        </Badge>
      ) : (
        <span className="ml-auto text-xs text-ink-400">Em breve</span>
      )}
    </div>
  );
}
