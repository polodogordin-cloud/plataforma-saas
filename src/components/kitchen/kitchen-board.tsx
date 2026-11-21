"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";
import { advanceKitchenOrder } from "@/actions/kitchen";
import { KitchenCard } from "@/components/kitchen/kitchen-card";
import { useKitchenOrders } from "@/components/kitchen/use-kitchen-orders";
import { cn } from "@/lib/utils";
import {
  KITCHEN_COLUMNS,
  KITCHEN_ACTION_TARGET,
  type KitchenAction,
  type KitchenColumn,
  type KitchenFilter,
  type KitchenOrder,
  type KitchenSettings,
  type KitchenStation,
} from "@/lib/types";
import { applyTimeFilters, groupByColumn, permittedActions, uniqueTables } from "@/lib/kitchen";

/**
 * Painel de cozinha.
 *
 * **Dois layouts, um componente.** O escopo pede tablet como alvo e adaptação
 * automática no celular — e colunas de 200px num telefone seriam quatro tiras
 * ilegíveis. Então:
 *
 *   • ≥ `lg` (1024px, que é iPad em paisagem e a maioria dos tablets Android):
 *     quatro colunas lado a lado, cada uma com scroll próprio. Cards grandes,
 *     que é o pedido explícito do escopo.
 *   • < `lg`: **abas** com contador. Uma coluna por vez, card ocupando a
 *     largura toda. A aba ativa mostra quantos pedidos há nas outras, para a
 *     cozinha não esquecer a fila de "Prontos" enquanto olha "Novos".
 *
 * A escolha por `lg` e não `md` é deliberada: em 768px (tablet em retrato) as
 * quatro colunas ficariam com ~180px cada, e o nome do item começaria a quebrar
 * em 3 linhas. Em retrato, abas é melhor mesmo sendo tablet.
 */

const PERMISSION: Record<KitchenAction, keyof RoleCaps> = {
  accept: "canOperate",
  start: "canOperate",
  ready: "canOperate",
  finish: "canFinish",
  cancel: "canCancel",
};

type RoleCaps = { canOperate: boolean; canFinish: boolean; canCancel: boolean };

function actionsFor(order: KitchenOrder, role: RoleCaps): KitchenAction[] {
  const all = permittedActions(order.status, role);
  return all.filter((action) => role[PERMISSION[action]]);
}

export function KitchenBoard({
  restaurantId,
  restaurantName,
  role,
  initialOrders,
  settings,
  stations,
}: {
  restaurantId: string;
  restaurantName: string;
  role: RoleCaps;
  initialOrders: KitchenOrder[];
  settings: KitchenSettings;
  stations: KitchenStation[];
}) {
  const [filter, setFilter] = useState<KitchenFilter>({
    tableId: null,
    station: null,
    lateOnly: false,
    recentOnly: false,
  });
  const [activeColumn, setActiveColumn] = useState<KitchenColumn>("new");
  const [pendingByOrder, setPendingByOrder] = useState<Record<string, KitchenAction>>({});
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const {
    orders,
    nowMs,
    lateAfter,
    warnAfter,
    loading,
    refresh,
    realtimeState,
    soundEnabled,
    soundBlocked,
    toggleSound,
    arrived,
    dismissArrival,
    markActed,
  } = useKitchenOrders({
    restaurantId,
    station: filter.station,
    initialOrders,
    initialLateAfter: settings.late_after_minutes,
    initialWarnAfter: settings.warn_after_minutes,
  });

  const timeSettings = useMemo(
    () => ({ late_after_minutes: lateAfter, warn_after_minutes: warnAfter }),
    [lateAfter, warnAfter],
  );

  const visible = useMemo(() => {
    const byTable = filter.tableId
      ? orders.filter((order) => order.table_id === filter.tableId)
      : orders;

    return applyTimeFilters(byTable, {
      nowMs,
      lateOnly: filter.lateOnly,
      recentOnly: filter.recentOnly,
      settings: timeSettings,
    });
  }, [orders, filter.tableId, filter.lateOnly, filter.recentOnly, nowMs, timeSettings]);

  const grouped = useMemo(() => groupByColumn(visible), [visible]);
  const tables = useMemo(() => uniqueTables(orders), [orders]);

  /**
   * `nowMs` é atualizado a cada segundo pelo hook; `weekly` não existe. O que
   * acontece aqui é que a contagem de atrasados depende do relógio, então ela é
   * recalculada a cada tick de propósito — mas são dezenas de pedidos, não
   * milhares, e nenhuma consulta ao banco é feita.
   */
  const lateCount = useMemo(
    () =>
      visible.filter(
        (order) =>
          order.created_at &&
          order.status !== "delivered" &&
          order.status !== "cancelled" &&
          Math.floor((nowMs - new Date(order.created_at).getTime()) / 60_000) >= lateAfter,
      ).length,
    [visible, nowMs, lateAfter],
  );

  const highlightedIds = useMemo(() => new Set(arrived.map((order) => order.id)), [arrived]);

  const runAction = useCallback(
    async (order: KitchenOrder, action: KitchenAction) => {
      setPendingByOrder((current) => ({ ...current, [order.id]: action }));
      setError(null);

      const target = KITCHEN_ACTION_TARGET[action];
      markActed(order.id, target);

      const result = await advanceKitchenOrder({ orderId: order.id, status: target });

      setPendingByOrder((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });

      if (!result.ok) {
        setError(result.error);
        // O otimista mentiu: relê para a tela voltar a dizer a verdade.
        void refresh({ silent: true });
      }
    },
    [markActed, refresh],
  );

  /* Alerta visual de pedido novo: título da aba pisca enquanto houver destaque. */
  useEffect(() => {
    if (arrived.length === 0) return;

    const base = `(${arrived.length}) ${restaurantName} · Cozinha`;
    document.title = base;

    return () => {
      document.title = `${restaurantName} · Cozinha`;
    };
  }, [arrived.length, restaurantName]);

  const activeFilters =
    (filter.tableId ? 1 : 0) +
    (filter.station ? 1 : 0) +
    (filter.lateOnly ? 1 : 0) +
    (filter.recentOnly ? 1 : 0);

  return (
    <div className="flex min-h-dvh flex-col bg-ink-50">
      {/* ---------------------------------------------------------------- */}
      {/* Barra superior: status, som, atualizar                            */}
      {/* ---------------------------------------------------------------- */}
      <header
        className="sticky top-0 z-30 border-b border-ink-200 bg-white/95 backdrop-blur-lg"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-2 px-3 py-2 sm:px-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold leading-tight text-ink-900 sm:text-lg">
              Cozinha
            </h1>
            <p className="flex items-center gap-1.5 truncate text-xs text-ink-500">
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-semibold",
                  realtimeState === "live" && "text-brand-700",
                  realtimeState === "connecting" && "text-amber-700",
                  realtimeState === "offline" && "text-red-700",
                )}
              >
                {realtimeState === "live" ? (
                  <Wifi className="size-3" aria-hidden="true" />
                ) : realtimeState === "connecting" ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                ) : (
                  <WifiOff className="size-3" aria-hidden="true" />
                )}
                {realtimeState === "live"
                  ? "Ao vivo"
                  : realtimeState === "connecting"
                    ? "Conectando"
                    : "Sem conexão"}
              </span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{restaurantName}</span>
            </p>
          </div>

          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={soundEnabled}
            aria-label={soundEnabled ? "Desativar som de novo pedido" : "Ativar som de novo pedido"}
            className={cn(
              "flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold",
              soundEnabled
                ? "bg-brand-50 text-brand-800 ring-1 ring-brand-200"
                : "bg-ink-100 text-ink-600 ring-1 ring-ink-200",
            )}
          >
            {soundEnabled ? (
              <Volume2 className="size-4" aria-hidden="true" />
            ) : (
              <VolumeX className="size-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">{soundEnabled ? "Som ligado" : "Som mudo"}</span>
          </button>

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Atualizar pedidos"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white ring-1 ring-ink-200 disabled:opacity-60"
          >
            <RefreshCw className={cn("size-4 text-ink-700", loading && "animate-spin")} aria-hidden="true" />
          </button>
        </div>

        {/* Filtros */}
        <div className="mx-auto w-full max-w-[1600px] px-3 pb-2 sm:px-4">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setFilter((f) => ({ ...f, lateOnly: !f.lateOnly }))}
              aria-pressed={filter.lateOnly}
              className={cn(
                "flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold ring-1",
                filter.lateOnly
                  ? "bg-red-600 text-white ring-red-600"
                  : "bg-white text-ink-700 ring-ink-200",
              )}
            >
              Atrasados
              {lateCount > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[0.65rem] font-bold tabular-nums",
                    filter.lateOnly ? "bg-white/25" : "bg-red-100 text-red-800",
                  )}
                >
                  {lateCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setFilter((f) => ({ ...f, recentOnly: !f.recentOnly }))}
              aria-pressed={filter.recentOnly}
              className={cn(
                "min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold ring-1",
                filter.recentOnly
                  ? "bg-ink-900 text-white ring-ink-900"
                  : "bg-white text-ink-700 ring-ink-200",
              )}
            >
              Recentes
            </button>

            <button
              type="button"
              onClick={() => setShowFilters((value) => !value)}
              aria-expanded={showFilters}
              className={cn(
                "flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold ring-1",
                activeFilters > 0
                  ? "bg-brand-600 text-white ring-brand-600"
                  : "bg-white text-ink-700 ring-ink-200",
              )}
            >
              Mesa e estação
              {activeFilters > 0 && (
                <span className="rounded-full bg-white/25 px-1.5 text-[0.65rem] font-bold tabular-nums">
                  {activeFilters}
                </span>
              )}
              <ChevronDown
                className={cn("size-3.5 transition-transform", showFilters && "rotate-180")}
                aria-hidden="true"
              />
            </button>

            {activeFilters > 0 && (
              <button
                type="button"
                onClick={() =>
                  setFilter({ tableId: null, station: null, lateOnly: false, recentOnly: false })
                }
                className="min-h-9 shrink-0 rounded-full px-3 text-xs font-semibold text-ink-500 underline"
              >
                Limpar
              </button>
            )}
          </div>

          {showFilters && (
            <div className="mt-2 grid gap-2 rounded-xl border border-ink-200 bg-white p-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold text-ink-600">Mesa</span>
                <select
                  value={filter.tableId ?? ""}
                  onChange={(event) =>
                    setFilter((f) => ({ ...f, tableId: event.target.value || null }))
                  }
                  className="mt-1 min-h-11 w-full rounded-lg border border-ink-200 bg-white px-2 text-sm"
                >
                  <option value="">Todas as mesas</option>
                  {tables.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.name}
                    </option>
                  ))}
                </select>
              </label>

              {stations.length > 0 && (
                <label className="block">
                  <span className="text-xs font-semibold text-ink-600">Estação</span>
                  <select
                    value={filter.station ?? ""}
                    onChange={(event) =>
                      setFilter((f) => ({ ...f, station: event.target.value || null }))
                    }
                    className="mt-1 min-h-11 w-full rounded-lg border border-ink-200 bg-white px-2 text-sm"
                  >
                    <option value="">Todas as estações</option>
                    {stations.map((station) => (
                      <option key={station.id} value={station.slug}>
                        {station.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Avisos                                                           */}
      {/* ---------------------------------------------------------------- */}
      {soundBlocked && soundEnabled && (
        <div className="mx-auto w-full max-w-[1600px] px-3 pt-2 sm:px-4">
          <p
            role="status"
            className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
          >
            O navegador bloqueou o som até você tocar na tela. Toque em{" "}
            <strong>Ativar som</strong> para liberar os avisos de novo pedido.
          </p>
        </div>
      )}

      {error && (
        <div className="mx-auto w-full max-w-[1600px] px-3 pt-2 sm:px-4">
          <p
            role="alert"
            className="flex items-center justify-between gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-900"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 text-xs font-bold underline"
            >
              Fechar
            </button>
          </p>
        </div>
      )}

      {/* Destaque de pedido novo */}
      {arrived.length > 0 && (
        <div className="mx-auto w-full max-w-[1600px] px-3 pt-2 sm:px-4">
          <div
            role="status"
            className="flex items-center gap-2 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
          >
            <BellRing className="size-4 shrink-0 motion-safe:animate-bounce" aria-hidden="true" />
            <span>
              {arrived.length === 1 && arrived[0]
                ? `Pedido novo: #${arrived[0].order_number} · ${arrived[0].table_name}`
                : `${arrived.length} pedidos novos`}
            </span>
            <button
              type="button"
              onClick={() => arrived.forEach((order) => dismissArrival(order.id))}
              className="ml-auto shrink-0 text-xs font-bold underline"
            >
              Dispensar
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Abas (celular)                                                   */}
      {/* ---------------------------------------------------------------- */}
      <div className="mx-auto w-full max-w-[1600px] px-3 pt-3 lg:hidden sm:px-4">
        <div
          role="tablist"
          aria-label="Colunas da cozinha"
          className="grid grid-cols-4 gap-1 rounded-xl bg-ink-100 p-1"
        >
          {KITCHEN_COLUMNS.map((column) => {
            const count = grouped[column.id].length;
            const active = activeColumn === column.id;
            return (
              <button
                key={column.id}
                role="tab"
                type="button"
                aria-selected={active}
                aria-controls={`kds-panel-${column.id}`}
                id={`kds-tab-${column.id}`}
                onClick={() => setActiveColumn(column.id)}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center rounded-lg px-1 text-xs font-bold leading-tight",
                  active ? "bg-white text-ink-900 shadow-sm" : "text-ink-600",
                )}
              >
                <span className="truncate">{column.label}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[0.7rem] tabular-nums",
                    count > 0 ? "bg-ink-900 text-white" : "text-ink-400",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Colunas (tablet/desktop)                                         */}
      {/* ---------------------------------------------------------------- */}
      <div className="mx-auto hidden w-full max-w-[1600px] flex-1 gap-3 p-3 lg:grid lg:grid-cols-4 sm:p-4">
        {KITCHEN_COLUMNS.map((column) => (
          <section key={column.id} className="flex min-h-0 flex-col">
            <h2 className="mb-2 flex items-baseline justify-between gap-2 px-1">
              <span className="text-sm font-bold uppercase tracking-wide text-ink-700">
                {column.label}
              </span>
              <span className="rounded-full bg-ink-200 px-2 py-0.5 text-xs font-bold tabular-nums text-ink-800">
                {grouped[column.id].length}
              </span>
            </h2>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4">
              {grouped[column.id].map((order) => (
                <KitchenCard
                  key={order.id}
                  order={order}
                  nowMs={nowMs}
                  settings={timeSettings}
                  actions={actionsFor(order, role)}
                  pending={pendingByOrder[order.id] ?? null}
                  highlighted={highlightedIds.has(order.id)}
                  onAction={(action) => void runAction(order, action)}
                  onDismissHighlight={() => dismissArrival(order.id)}
                />
              ))}
              {grouped[column.id].length === 0 && (
                <EmptyColumn column={column.id} filtered={activeFilters > 0} />
              )}
            </div>
          </section>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Aba ativa (celular)                                              */}
      {/* ---------------------------------------------------------------- */}
      <div className="mx-auto w-full max-w-[1600px] flex-1 px-3 pb-8 lg:hidden sm:px-4">
        {KITCHEN_COLUMNS.map((column) => (
          <div
            key={column.id}
            role="tabpanel"
            id={`kds-panel-${column.id}`}
            aria-labelledby={`kds-tab-${column.id}`}
            hidden={activeColumn !== column.id}
            className="space-y-3 pt-3"
          >
            {grouped[column.id].map((order) => (
              <KitchenCard
                key={order.id}
                order={order}
                nowMs={nowMs}
                settings={timeSettings}
                actions={actionsFor(order, role)}
                pending={pendingByOrder[order.id] ?? null}
                highlighted={highlightedIds.has(order.id)}
                onAction={(action) => void runAction(order, action)}
                onDismissHighlight={() => dismissArrival(order.id)}
              />
            ))}
            {grouped[column.id].length === 0 && (
              <EmptyColumn column={column.id} filtered={activeFilters > 0} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Coluna sem pedidos.
 *
 * "Nenhum pedido aqui" e "nenhum pedido com esse filtro" são mensagens
 * diferentes de propósito: a primeira é boa notícia (cozinha em dia), a segunda
 * faz o operador procurar o pedido que ele sabe que existe.
 */
function EmptyColumn({ column, filtered }: { column: KitchenColumn; filtered: boolean }) {
  const meta = KITCHEN_COLUMNS.find((item) => item.id === column);

  if (filtered) {
    return (
      <p className="rounded-xl border border-dashed border-ink-300 bg-white/60 px-3 py-6 text-center text-sm text-ink-500">
        Nenhum pedido com os filtros atuais.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-ink-300 bg-white/60 px-3 py-6 text-center">
      <CheckCircle2 className="mx-auto size-6 text-ink-300" aria-hidden="true" />
      <p className="mt-1.5 text-sm font-semibold text-ink-600">Nada em {meta?.label.toLowerCase()}</p>
      <p className="mt-0.5 text-xs text-ink-400">{meta?.hint}</p>
    </div>
  );
}
