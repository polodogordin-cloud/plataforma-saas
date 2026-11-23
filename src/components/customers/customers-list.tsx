"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, Search, Star, X } from "lucide-react";
import { Badge, Card } from "@/components/ui/card";
import { MAX_SEARCH, ACTIVITY_LABEL, customerActivity, formatPhone } from "@/lib/loyalty";
import { listCustomers } from "@/lib/data/customers-client";
import { formatPrice } from "@/lib/validation";
import type { Customer } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Lista de clientes do painel — Etapa 24.
 *
 * ─── Busca no servidor, não no navegador ──────────────────────────────────
 *
 * A primeira página vem renderizada pelo servidor (a página é RSC). A partir
 * daí, busca e "carregar mais" chamam a RPC pelo cliente — não dá para baixar
 * 5.000 clientes no celular do dono para filtrar em JavaScript.
 *
 * O campo de busca tem debounce de 350 ms: cada tecla é uma ida ao banco e, sem
 * o atraso, digitar "maria" faria cinco consultas para mostrar um resultado.
 *
 * ─── Cliente apagado continua na lista ───────────────────────────────────
 *
 * `erased_at` preenchido aparece como "Dados excluídos", não some: o dono
 * precisa conseguir abrir a ficha e ver que a exclusão foi feita. Sumir da
 * lista faria parecer que o pedido de exclusão se perdeu.
 */
export function CustomersList({
  restaurantId,
  initialCustomers,
  initialTotal,
  programEnabled,
  timeZone,
}: {
  restaurantId: string;
  initialCustomers: Customer[];
  initialTotal: number;
  programEnabled: boolean;
  timeZone: string;
}) {
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [total, setTotal] = useState(initialTotal);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Evita resposta antiga sobrescrevendo busca nova (ordem de rede). */
  const requestId = useRef(0);

  const fetchPage = useCallback(
    async (search: string, offset: number) => {
      const id = ++requestId.current;
      const result = await listCustomers({ restaurantId, search, limit: 50, offset });

      // Só a última requisição pode pintar a tela.
      if (id !== requestId.current) return null;
      return result;
    },
    [restaurantId],
  );

  useEffect(() => {
    const term = query.trim();

    // Sem termo: volta para a lista inicial já carregada pelo servidor.
    if (!term) {
      setSearching(false);
      setError(null);
      setCustomers(initialCustomers);
      setTotal(initialTotal);
      return;
    }

    setSearching(true);
    const timer = setTimeout(async () => {
      const result = await fetchPage(term, 0);
      if (result) {
        setCustomers(result.customers);
        setTotal(result.total);
        setError(null);
      }
      setSearching(false);
    }, 350);

    return () => clearTimeout(timer);
  }, [query, fetchPage, initialCustomers, initialTotal]);

  const loadMore = async () => {
    setLoadingMore(true);
    const result = await fetchPage(query.trim(), customers.length);
    if (result) {
      /*
       * Deduplica por id: um cliente novo pode entrar no topo entre uma página
       * e outra (alguém acabou de pedir), e sem isso ele apareceria duas vezes
       * na lista.
       */
      setCustomers((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...result.customers.filter((item) => !seen.has(item.id))];
      });
      setTotal(result.total);
    }
    setLoadingMore(false);
  };

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        timeZone,
      }),
    [timeZone],
  );

  const hasMore = customers.length < total;

  return (
    <div className="space-y-3">
      {/* ---------------------------------------------------------- busca */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, MAX_SEARCH))}
          placeholder="Buscar por nome ou WhatsApp"
          aria-label="Buscar cliente por nome ou WhatsApp"
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

      <div className="flex items-center justify-between px-0.5">
        <p className="text-xs text-ink-500" aria-live="polite">
          {searching ? "Buscando…" : `${total} ${total === 1 ? "cliente" : "clientes"}`}
        </p>
        {!programEnabled && <Badge tone="neutral">Pontos desativados</Badge>}
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}

      {/* ----------------------------------------------------------- lista */}
      {customers.length === 0 ? (
        <Card className="space-y-2 py-8 text-center">
          <p className="text-sm font-semibold text-ink-900">
            {query.trim() ? "Nenhum cliente com esse nome ou número" : "Nenhum cliente ainda"}
          </p>
          <p className="mx-auto max-w-[28ch] text-xs leading-snug text-ink-500">
            {query.trim()
              ? "Confira a grafia ou tente só parte do telefone."
              : "O cliente entra na lista quando informa nome ou WhatsApp ao fazer um pedido. Ninguém precisa se cadastrar para ver o cardápio."}
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {customers.map((customer) => {
            const activity = customerActivity(customer.last_order_at);
            const erased = Boolean(customer.erased_at);

            return (
              <li key={customer.id}>
                <Link
                  href={`/app/clientes/${customer.id}`}
                  className="flex min-h-16 items-center gap-3 rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 active:scale-[0.99]"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-600">
                    <Star className="size-4" aria-hidden="true" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-ink-900">
                        {customer.name ?? formatPhone(customer.phone) ?? "Cliente"}
                      </span>
                      {erased ? (
                        <Badge tone="neutral">Excluído</Badge>
                      ) : (
                        programEnabled &&
                        customer.points_balance > 0 && (
                          <span className="shrink-0 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-brand-700">
                            {customer.points_balance.toLocaleString("pt-BR")} pts
                          </span>
                        )
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-500">
                      <span className="tabular-nums">
                        {customer.total_orders} {customer.total_orders === 1 ? "pedido" : "pedidos"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{formatPrice(customer.total_spent)}</span>
                      {customer.last_order_at && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{formatter.format(new Date(customer.last_order_at))}</span>
                        </>
                      )}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-1">
                    <span
                      className={cn(
                        "text-[10px] font-semibold",
                        activity === "active" && !erased ? "text-brand-700" : "text-ink-400",
                      )}
                    >
                      {erased ? "" : ACTIVITY_LABEL[activity]}
                    </span>
                    <ChevronRight className="size-4 text-ink-300" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white text-sm font-semibold text-ink-700 active:scale-[0.99] disabled:opacity-60"
        >
          {loadingMore && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {loadingMore ? "Carregando…" : `Carregar mais (${total - customers.length})`}
        </button>
      )}
    </div>
  );
}
