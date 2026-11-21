import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowUpRight,
  Building2,
  CreditCard,
  ExternalLink,
  Package,
  Palette,
  Receipt,
  Tags,
  UtensilsCrossed,
} from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { RestaurantActions } from "@/components/admin/restaurant-actions";
import { MembersSection } from "@/components/admin/members-section";
import { RestaurantStatusBadge } from "@/components/admin/status-badge";
import { Badge } from "@/components/ui/card";
import { getAdminRestaurantDetail } from "@/lib/data/admin";
import { ORDER_STATUS_LABEL, SUBSCRIPTION_STATUS_LABEL } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { formatPrice } from "@/lib/validation";

export const metadata: Metadata = { title: "Restaurante" };
export const dynamic = "force-dynamic";

/**
 * Detalhe de uma casa — a tela de suporte.
 *
 * Sete blocos do escopo (informações, usuários, produtos, categorias, mesas,
 * pedidos, configurações) em `<details>` nativos: accordion sem JavaScript,
 * acessível por teclado e por leitor de tela de graça, e o primeiro bloco abre
 * aberto para a tela não nascer vazia.
 *
 * Uma consulta só (`admin_restaurant_detail`) traz tudo: sete round-trips no
 * celular em 4G seria desperdício puro.
 */
export default async function AdminRestaurantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getAdminRestaurantDetail(id);
  if (!detail) notFound();

  const { restaurant, counts, members, products, categories, tables, orders, theme } = detail;

  return (
    <>
      <AdminHeader
        title={restaurant.name}
        subtitle={`/r/${restaurant.slug}`}
        backHref="/admin/restaurantes"
      />

      <main className="app-shell space-y-4 px-4 py-4">
        {/* Cabeçalho da casa */}
        <section className="card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <RestaurantStatusBadge status={restaurant.status} />
                <Badge tone="muted">Plano {restaurant.plan_id ?? "—"}</Badge>
                {restaurant.subscription_status !== "none" && (
                  <Badge tone="info">
                    {SUBSCRIPTION_STATUS_LABEL[restaurant.subscription_status ?? "none"]}
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-sm text-ink-600">
                {restaurant.description ?? "Sem descrição cadastrada."}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <Info label="Cadastro" value={formatDate(restaurant.created_at)} />
                <Info label="Telefone" value={restaurant.phone ?? "—"} />
                <Info
                  label="Cidade"
                  value={
                    restaurant.city
                      ? `${restaurant.city}${restaurant.state ? `/${restaurant.state}` : ""}`
                      : "—"
                  }
                />
                <Info label="Fuso" value={restaurant.timezone} />
              </dl>
            </div>
            <Link
              href={`/r/${restaurant.slug}`}
              target="_blank"
              className="tap-target grid shrink-0 place-items-center rounded-xl text-ink-500 hover:bg-ink-100"
              aria-label="Ver cardápio público em nova aba"
            >
              <ExternalLink className="size-5" aria-hidden="true" />
            </Link>
          </div>

          {restaurant.suspended_reason && restaurant.status === "suspended" && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <strong className="font-semibold">Suspenso:</strong>{" "}
              {restaurant.suspended_reason}
              {restaurant.suspended_at && (
                <span className="mt-0.5 block text-xs text-red-700">
                  em {formatDate(restaurant.suspended_at)}
                </span>
              )}
            </div>
          )}

          <div className="mt-4">
            <RestaurantActions
              restaurantId={restaurant.id}
              restaurantName={restaurant.name}
              slug={restaurant.slug}
              status={restaurant.status}
              suspendedReason={restaurant.suspended_reason ?? null}
            />
          </div>
        </section>

        {/* Números */}
        <section aria-label="Contagens" className="grid grid-cols-3 gap-2">
          <MiniStat label="Produtos" value={counts.products} />
          <MiniStat label="Categorias" value={counts.categories} />
          <MiniStat label="Mesas" value={counts.tables} />
          <MiniStat label="Pedidos" value={counts.orders} />
          <MiniStat label="Hoje" value={counts.orders_today} />
          <MiniStat label="Pessoas" value={counts.members} />
        </section>

        {/* Usuários */}
        <MembersSection restaurantId={restaurant.id} members={members} />

        {/* Produtos */}
        <Accordion
          icon={Package}
          title="Produtos"
          count={products.length}
          summary={
            products.length
              ? `${products.filter((p) => p.is_available).length} disponíveis de ${products.length}`
              : "Nenhum produto cadastrado"
          }
        >
          {products.length === 0 ? (
            <Empty>Esta casa ainda não cadastrou produtos.</Empty>
          ) : (
            <ul className="divide-y divide-ink-100">
              {products.map((product) => (
                <li key={product.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-900">{product.name}</span>
                    <span className="block truncate text-xs text-ink-500">
                      {product.category_name ?? "Sem categoria"}
                    </span>
                  </span>
                  {!product.is_available && <Badge tone="warning">Esgotado</Badge>}
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-800">
                    {formatPrice(product.price)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Accordion>

        {/* Categorias */}
        <Accordion
          icon={Tags}
          title="Categorias"
          count={categories.length}
          summary={categories.length ? undefined : "Nenhuma categoria"}
        >
          {categories.length === 0 ? (
            <Empty>Sem categorias.</Empty>
          ) : (
            <ul className="divide-y divide-ink-100">
              {categories.map((category) => (
                <li key={category.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-900">
                    {category.name}
                  </span>
                  {!category.is_active && <Badge tone="muted">Oculta</Badge>}
                  <span className="shrink-0 text-xs tabular-nums text-ink-500">
                    {category.products_count}{" "}
                    {category.products_count === 1 ? "item" : "itens"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Accordion>

        {/* Mesas */}
        <Accordion
          icon={UtensilsCrossed}
          title="Mesas"
          count={tables.length}
          summary={tables.length ? undefined : "Nenhuma mesa"}
        >
          {tables.length === 0 ? (
            <Empty>Sem mesas cadastradas. Sem mesa, não há QR Code nem pedido no salão.</Empty>
          ) : (
            <ul className="divide-y divide-ink-100">
              {tables.map((table) => (
                <li key={table.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-900">
                    {table.name}
                  </span>
                  {!table.is_active && <Badge tone="muted">Inativa</Badge>}
                  <Link
                    href={`/r/${restaurant.slug}/table/${table.public_token}`}
                    target="_blank"
                    className="tap-target inline-flex items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                  >
                    Abrir
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Accordion>

        {/* Pedidos */}
        <Accordion
          icon={Receipt}
          title="Pedidos"
          count={counts.orders}
          summary={counts.orders ? `Últimos ${orders.length} · ${counts.orders_today} hoje` : "Nenhum pedido"}
        >
          {orders.length === 0 ? (
            <Empty>Nenhum pedido registrado nesta casa.</Empty>
          ) : (
            <ul className="divide-y divide-ink-100">
              {orders.map((order) => (
                <li key={order.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink-900">
                      #{order.order_number} · {order.table_name ?? "—"}
                    </span>
                    <span className="block text-xs text-ink-500">
                      {formatDate(order.created_at)} · {ORDER_STATUS_LABEL[order.status]}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-800">
                    {formatPrice(order.total)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Accordion>

        {/* Configurações */}
        <Accordion
          icon={Palette}
          title="Configurações"
          summary={
            theme
              ? `Tema ${theme.preset ?? "personalizado"} · atualizado em ${formatDate(theme.updated_at)}`
              : "Tema padrão (nunca personalizado)"
          }
        >
          <div className="space-y-3">
            {theme ? (
              <div className="flex flex-wrap gap-1.5">
                {[
                  ["Principal", theme.primary_color],
                  ["Secundária", theme.secondary_color],
                  ["Fundo", theme.background_color],
                  ["Texto", theme.text_color],
                  ["Botão", theme.button_color],
                ].map(([label, color]) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-2 py-1 text-xs text-ink-700"
                  >
                    <span
                      className="size-3.5 rounded-full ring-1 ring-inset ring-black/10"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    {label} <code className="text-[0.68rem] text-ink-500">{color}</code>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-500">
                A casa nunca personalizou: o cardápio usa o tema padrão da
                plataforma. Nada quebra por isso.
              </p>
            )}

            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <Info label="Estilo do card" value={theme?.card_style ?? "—"} />
              <Info label="Estilo do botão" value={theme?.button_style ?? "—"} />
              <Info label="Logo" value={theme?.logo_url ? "Enviada" : "Sem logo"} />
              <Info label="Capa" value={theme?.cover_url ? "Enviada" : "Sem capa"} />
            </dl>

            <div className="rounded-xl bg-ink-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                <CreditCard className="size-3.5" aria-hidden="true" />
                Plano e assinatura
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <Info label="Plano" value={restaurant.plan_id ?? "—"} />
                <Info
                  label="Assinatura"
                  value={SUBSCRIPTION_STATUS_LABEL[restaurant.subscription_status ?? "none"]}
                />
                <Info
                  label="Início"
                  value={restaurant.subscription_start ? formatDate(restaurant.subscription_start) : "—"}
                />
                <Info
                  label="Fim"
                  value={restaurant.subscription_end ? formatDate(restaurant.subscription_end) : "—"}
                />
              </dl>
              <p className="mt-2 text-[0.7rem] leading-snug text-ink-500">
                Cobrança entra na próxima etapa. Os campos já existem para que
                ativar um plano não exija migração de dados.
              </p>
            </div>
          </div>
        </Accordion>

        <p className="pb-2 text-center text-[0.7rem] text-ink-400">
          ID interno <code className="text-[0.68rem]">{restaurant.id}</code>
        </p>
      </main>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-400">{label}</dt>
      <dd className="truncate font-medium text-ink-800">{value}</dd>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-ink-200/70 bg-white p-2.5 text-center">
      <p className="text-lg font-semibold leading-none tabular-nums text-ink-900">{value}</p>
      <p className="mt-1 text-[0.68rem] text-ink-500">{label}</p>
    </div>
  );
}

function Accordion({
  icon: Icon,
  title,
  count,
  summary,
  children,
  open = false,
}: {
  icon: typeof Package;
  title: string;
  count?: number;
  summary?: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="card group px-0 py-0" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[var(--radius-card)] px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-600">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink-900">
            {title}
            {typeof count === "number" && (
              <span className="ml-1.5 text-xs font-normal tabular-nums text-ink-400">{count}</span>
            )}
          </span>
          {summary && <span className="block truncate text-xs text-ink-500">{summary}</span>}
        </span>
        <Building2
          className="size-4 shrink-0 text-ink-300 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-ink-100 px-4 py-2">{children}</div>
    </details>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-3 text-sm text-ink-500">{children}</p>;
}
