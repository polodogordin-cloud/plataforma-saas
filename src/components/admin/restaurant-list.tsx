"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Loader2,
  Package,
  Search,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { setRestaurantStatus } from "@/actions/admin";
import { RestaurantStatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ADMIN_STATUS_FILTERS, type AdminRestaurantRow, type AdminStatusFilter } from "@/lib/types";
import { cn, formatDate, normalizeSearch } from "@/lib/utils";

/**
 * Lista de restaurantes do painel master.
 *
 * A busca acontece **no cliente** sobre o conjunto já carregado — a lista head
 * de uma plataforma pequena cabe em uma consulta, e filtrar localmente dá
 * resposta instantânea sem uma ida ao banco por tecla digitada. O servidor
 * também sabe buscar (`admin_list_restaurants(p_search)`), e é ele que responde
 * quando a lista vier paginada no futuro.
 *
 * Ativar/desativar/suspender abre uma confirmação em bottom sheet: suspender
 * exige motivo e derruba o cardápio público, então não pode ser um toque
 * acidental.
 */
export function RestaurantList({
  restaurants,
  initialStatus = "all",
}: {
  restaurants: AdminRestaurantRow[];
  initialStatus?: AdminStatusFilter;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AdminStatusFilter>(initialStatus);
  const [target, setTarget] = useState<AdminRestaurantRow | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const key = normalizeSearch(query);
    return restaurants.filter((restaurant) => {
      const matchesStatus = status === "all" || restaurant.status === status;
      if (!matchesStatus) return false;
      if (!key) return true;

      return [
        restaurant.name,
        restaurant.slug,
        restaurant.phone,
        restaurant.owner_name,
        restaurant.owner_email,
      ]
        .map((value) => normalizeSearch(value))
        .some((value) => value.includes(key));
    });
  }, [restaurants, query, status]);

  // Contagem por filtro: mostra o que existe, não só o que sobrou.
  const counts = useMemo(() => {
    const base: Record<string, number> = { all: restaurants.length };
    for (const restaurant of restaurants) {
      base[restaurant.status] = (base[restaurant.status] ?? 0) + 1;
    }
    return base;
  }, [restaurants]);

  const openSheet = (restaurant: AdminRestaurantRow) => {
    setTarget(restaurant);
    setReason("");
    setError(null);
  };

  const closeSheet = () => {
    if (pending) return;
    setTarget(null);
    setError(null);
  };

  const apply = (next: "published" | "paused" | "suspended") => {
    if (!target) return;

    // Suspender sem motivo é o único caso que não chega ao servidor: o banco
    // também recusaria (`reason_required`), mas aqui a resposta é imediata e
    // não custa uma ida de rede.
    if (next === "suspended" && !reason.trim()) {
      setError("Informe o motivo da suspensão.");
      return;
    }

    startTransition(async () => {
      const result = await setRestaurantStatus({
        restaurantId: target.id,
        status: next,
        reason: next === "suspended" ? reason : null,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setTarget(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {/* Busca */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nome, link, telefone ou responsável"
          aria-label="Buscar restaurantes"
          className="h-12 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-10 text-[0.95rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Limpar busca"
            className="tap-target absolute right-0 top-0 grid w-11 place-items-center text-ink-400 hover:text-ink-700"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-1.5" role="group" aria-label="Filtrar por status">
          {ADMIN_STATUS_FILTERS.map((filter) => {
            const active = status === filter.id;
            const count = counts[filter.id] ?? 0;

            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => setStatus(filter.id)}
                aria-pressed={active}
                className={cn(
                  "tap-target inline-flex items-center gap-1.5 rounded-full px-3 text-[0.82rem] font-semibold transition-colors",
                  active
                    ? "bg-ink-900 text-white"
                    : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50",
                )}
              >
                {filter.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[0.68rem] tabular-nums",
                    active ? "bg-white/20" : "bg-ink-100 text-ink-500",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center px-5 py-9 text-center">
          <Search className="size-6 text-ink-300" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-ink-700">Nenhum restaurante encontrado</p>
          <p className="mt-1 text-sm text-ink-500">
            {query ? `Nada corresponde a “${query}”.` : "Não há restaurantes neste filtro."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((restaurant) => (
            <li key={restaurant.id} className="card p-0">
              <div className="flex items-start gap-3 p-3.5">
                <Link
                  href={`/admin/restaurantes/${restaurant.id}`}
                  className="min-w-0 flex-1"
                  aria-label={`Abrir ${restaurant.name}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-[0.95rem] font-semibold text-ink-900">
                      {restaurant.name}
                    </p>
                    <RestaurantStatusBadge status={restaurant.status} />
                  </div>

                  <p className="mt-0.5 truncate text-xs text-ink-500">/r/{restaurant.slug}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.72rem] text-ink-500">
                    <span className="inline-flex items-center gap-1">
                      <Package className="size-3.5" aria-hidden="true" />
                      {restaurant.products_count}{" "}
                      {restaurant.products_count === 1 ? "produto" : "produtos"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UtensilsCrossed className="size-3.5" aria-hidden="true" />
                      {restaurant.tables_count}{" "}
                      {restaurant.tables_count === 1 ? "mesa" : "mesas"}
                    </span>
                    <span>Desde {formatDate(restaurant.created_at)}</span>
                  </div>

                  {restaurant.owner_email && (
                    <p className="mt-1 truncate text-[0.72rem] text-ink-400">
                      {restaurant.owner_name ?? "Responsável"} · {restaurant.owner_email}
                    </p>
                  )}

                  {restaurant.status === "suspended" && restaurant.suspended_reason && (
                    <p className="mt-1.5 rounded-lg bg-red-50 px-2 py-1 text-[0.72rem] text-red-700">
                      Motivo: {restaurant.suspended_reason}
                    </p>
                  )}
                </Link>

                <ChevronRight className="mt-1 size-4 shrink-0 text-ink-300" aria-hidden="true" />
              </div>

              <div className="flex items-center gap-1.5 border-t border-ink-100 px-2 py-1.5">
                <Button size="sm" variant="ghost" onClick={() => openSheet(restaurant)}>
                  Alterar status
                </Button>
                <Link
                  href={`/admin/restaurantes/${restaurant.id}`}
                  className="tap-target ml-auto inline-flex items-center gap-1 rounded-lg px-3 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                >
                  Ver detalhes
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Confirmação de status */}
      <Sheet open={Boolean(target)} onClose={closeSheet} title="Alterar status">
        {target && (
          <div className="space-y-4">
            <p className="text-sm text-ink-600">
              <strong className="font-semibold text-ink-900">{target.name}</strong> está{" "}
              {target.status === "published" ? "ativo" : "fora do ar"} hoje.
            </p>

            <div className="space-y-2">
              <StatusOption
                label="Ativo"
                description="Cardápio público no ar e painel liberado."
                active={target.status === "published"}
                onClick={() => apply("published")}
                disabled={pending}
              />
              <StatusOption
                label="Desativado"
                description="Some do cardápio público, mas o dono continua acessando o painel."
                active={target.status === "paused"}
                onClick={() => apply("paused")}
                disabled={pending}
              />
              <StatusOption
                label="Suspenso"
                description="Bloqueia o painel e o cardápio. Exige motivo."
                active={target.status === "suspended"}
                onClick={() => apply("suspended")}
                disabled={pending}
                danger
              />
            </div>

            {/* O campo aparece sempre, e não só ao escolher "Suspenso": o admin
                precisa poder escrever o motivo ANTES de confirmar. */}
            {(
              <label className="block">
                <span className="text-sm font-medium text-ink-800">
                  Motivo (o dono vê este texto)
                </span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  maxLength={280}
                  placeholder="Ex.: pendência de pagamento, uso indevido…"
                  className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
                <span className="mt-1 flex items-center justify-between gap-2 text-[0.7rem] text-ink-400">
                  <span>Obrigatório para suspender</span>
                  <span>{reason.length}/280</span>
                </span>
              </label>
            )}

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            {pending && (
              <p className="flex items-center gap-2 text-sm text-ink-500">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Aplicando…
              </p>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

function StatusOption({
  label,
  description,
  active,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || active}
      aria-pressed={active}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
        active
          ? "border-brand-300 bg-brand-50"
          : danger
            ? "border-red-200 bg-white hover:bg-red-50"
            : "border-ink-200 bg-white hover:bg-ink-50",
        (disabled || active) && "opacity-70",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-2",
          active
            ? danger
              ? "border-red-600 bg-red-600"
              : "border-brand-600 bg-brand-600"
            : "border-ink-300",
        )}
        aria-hidden="true"
      >
        {active && <span className="size-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block text-sm font-semibold",
            danger ? "text-red-800" : "text-ink-900",
          )}
        >
          {label}
          {active && <span className="ml-1.5 text-[0.7rem] font-normal text-ink-500">(atual)</span>}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-500">{description}</span>
      </span>
    </button>
  );
}
