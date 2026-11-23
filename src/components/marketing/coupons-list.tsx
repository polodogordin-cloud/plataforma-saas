"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, Plus, Search, TicketPercent, X } from "lucide-react";
import { Badge, Card } from "@/components/ui/card";
import { setCouponActive } from "@/actions/coupons";
import {
  COUPON_STATUS_LABEL,
  describeCoupon,
  describeUsage,
  describeValidity,
  type Coupon,
  type CouponStatus,
} from "@/lib/coupons";
import { cn } from "@/lib/utils";

/**
 * Lista de cupons — Etapa 25.
 *
 * ─── O que cada linha mostra, e por quê ───────────────────────────────────
 *
 * O escopo pede: código, tipo, valor, validade, quantidade, uso atual e status.
 * Sete informações em 320 px é o problema de desenho desta tela. A solução foi
 * **três níveis de leitura**:
 *
 *   1. **código** (grande, tabular) — é o que o dono procura;
 *   2. **regra** (uma linha) — "10% de desconto · mínimo R$ 30";
 *   3. **rodapé** (uma linha) — "3 de 100 usos · Até 31/12" + o status.
 *
 * O tipo e o valor ficam na **regra**, não em colunas separadas: "10%" e
 * "Percentual" lado a lado repetem a mesma informação. Quem precisa do tipo
 * cru abre a ficha.
 *
 * ─── Ligar/desligar sem abrir a ficha ─────────────────────────────────────
 *
 * É o toque mais frequente da tela ("acabou a promoção"). Um switch na linha
 * evita três toques (abrir → editar → salvar) para uma decisão de um segundo.
 * O status é recalculado no servidor e volta pelo `revalidatePath`.
 */
export function CouponsList({
  initialCoupons,
  timeZone,
}: {
  initialCoupons: Coupon[];
  timeZone: string;
}) {
  const [coupons, setCoupons] = useState(initialCoupons);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /*
   * Busca e filtro no navegador, ao contrário da lista de clientes (Etapa 24).
   *
   * A diferença é o volume: uma casa tem dezenas de cupons, não milhares de
   * clientes. Baixar tudo e filtrar aqui é instantâneo e evita uma ida ao
   * servidor por tecla digitada. Se um dia passar de ~200, a RPC já aceita
   * `p_search` — é só trocar como a lista de clientes fez.
   */
  const visible = useMemo(() => {
    const term = query.trim().toUpperCase();
    return coupons.filter((coupon) => {
      if (filter === "active" && (coupon.status === "inactive" || coupon.status === "expired")) {
        return false;
      }
      if (filter === "inactive" && coupon.status !== "inactive" && coupon.status !== "expired") {
        return false;
      }
      if (!term) return true;
      return coupon.code.includes(term) || coupon.name.toUpperCase().includes(term);
    });
  }, [coupons, query, filter]);

  const toggle = (coupon: Coupon) => {
    const next = !coupon.active;

    // Otimista: o switch responde na hora. Se a action falhar, volta e avisa.
    setCoupons((current) =>
      current.map((item) =>
        item.id === coupon.id
          ? {
              ...item,
              active: next,
              status: next
                ? item.status === "inactive"
                  ? "active"
                  : item.status
                : "inactive",
            }
          : item,
      ),
    );
    setError(null);

    startTransition(async () => {
      const result = await setCouponActive(coupon.id, next);
      if (!result.ok) {
        setCoupons((current) =>
          current.map((item) => (item.id === coupon.id ? coupon : item)),
        );
        setError(result.error ?? "Não foi possível atualizar o cupom.");
      }
    });
  };

  return (
    <div className="space-y-3">
      {/* -------------------------------------------------------- filtros */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, 40))}
          placeholder="Buscar por código ou nome"
          aria-label="Buscar cupom por código ou nome"
          className="min-h-11 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-9 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Limpar busca"
            className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-ink-400"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex gap-1.5" role="tablist" aria-label="Filtrar cupons">
        {(
          [
            ["all", "Todos"],
            ["active", "No ar"],
            ["inactive", "Parados"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "min-h-9 flex-1 rounded-lg text-xs font-semibold transition-colors",
              filter === value
                ? "bg-ink-900 text-white"
                : "bg-ink-100 text-ink-600 active:scale-[0.98]",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}

      {/* ---------------------------------------------------------- lista */}
      {visible.length === 0 ? (
        <Card className="space-y-2 py-8 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-xl bg-ink-100 text-ink-500">
            <TicketPercent className="size-5" aria-hidden="true" />
          </span>
          <p className="text-sm font-semibold text-ink-900">
            {query || filter !== "all" ? "Nenhum cupom com esse filtro" : "Nenhum cupom ainda"}
          </p>
          <p className="mx-auto max-w-[30ch] text-xs leading-snug text-ink-500">
            {query || filter !== "all"
              ? "Tente outro código, outro nome ou limpe o filtro."
              : "Crie um cupom de boas-vindas, de aniversário ou para uma data específica."}
          </p>
          {!query && filter === "all" && (
            <Link
              href="/app/marketing/cupons/novo"
              className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-xs font-bold text-white active:scale-[0.99]"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Criar primeiro cupom
            </Link>
          )}
        </Card>
      ) : (
        <ul className="space-y-2">
          {visible.map((coupon) => (
            <li key={coupon.id}>
              <Card className={cn("space-y-2 p-0", !coupon.active && "bg-ink-50/60")}>
                <Link
                  href={`/app/marketing/cupons/${coupon.id}`}
                  className="block px-3.5 pb-2 pt-3 active:opacity-80"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "truncate font-mono text-base font-bold tracking-wide",
                          coupon.active ? "text-ink-900" : "text-ink-500",
                        )}
                      >
                        {coupon.code}
                      </p>
                      <p className="truncate text-xs text-ink-500">{coupon.name}</p>
                    </div>
                    <StatusBadge status={coupon.status} />
                  </div>

                  <p className="mt-1.5 text-sm font-medium leading-snug text-ink-800">
                    {describeCoupon(coupon)}
                  </p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-500">
                    <span className="tabular-nums">{describeUsage(coupon.used_count, coupon.max_uses)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="size-3" aria-hidden="true" />
                      {describeValidity(coupon.starts_at, coupon.ends_at, timeZone)}
                    </span>
                    {coupon.total_discount > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">
                          R$ {coupon.total_discount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}{" "}
                          abatidos
                        </span>
                      </>
                    )}
                  </div>
                </Link>

                {/* Ligar/desligar: alvo de toque próprio, separado do link. */}
                <div className="flex items-center justify-between border-t border-ink-100 px-3.5 py-2">
                  <span className="text-[11px] font-medium text-ink-500">
                    {coupon.active ? "Disponível para uso" : "Não aparece para o cliente"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={coupon.active}
                    aria-label={`${coupon.active ? "Desativar" : "Ativar"} cupom ${coupon.code}`}
                    disabled={pending}
                    onClick={() => toggle(coupon)}
                    className={cn(
                      "relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-60",
                      coupon.active ? "bg-brand-600" : "bg-ink-300",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
                        coupon.active ? "translate-x-[1.125rem]" : "translate-x-0.5",
                      )}
                    />
                  </button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: CouponStatus }) {
  const tone =
    status === "active"
      ? "success"
      : status === "scheduled"
        ? "info"
        : status === "exhausted"
          ? "warning"
          : "neutral";

  return (
    <Badge tone={tone} className="shrink-0">
      {COUPON_STATUS_LABEL[status]}
    </Badge>
  );
}
