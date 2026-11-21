"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  BellRing,
  ChevronRight,
  ClipboardList,
  Loader2,
  RefreshCw,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { OrderCard } from "@/components/orders/order-card";
import { OrderDetailSheet } from "@/components/orders/order-detail-sheet";
import { useOrdersRealtime } from "@/components/orders/use-orders-realtime";
import { usePanelOrders } from "@/components/orders/use-panel-orders";
import { RequestsPanelHost } from "@/components/orders/requests-panel-host";
import { setOrderStatus } from "@/actions/orders-panel";
import {
  primeAudio,
  playNewOrderSound,
  readSoundPreference,
  saveSoundPreference,
  vibrateNewOrder,
} from "@/lib/notify";
import {
  ORDER_STATUS_BOARD_LABEL,
  PANEL_TABS,
  type OrderStatus,
  type PanelOrder,
  type PanelTab,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Painel de pedidos — Etapa 7.
 *
 * Estrutura da tela:
 *
 *  - **Alertas** (`alert`): pedido novo que ainda não foi confirmado. Aparece
 *    no topo, com número, mesa e total, e o som/vibração tocam quando chega.
 *  - **Abas**: Novos · Em preparo · Prontos · Finalizados, cada uma com o
 *    contador de pedidos naquele recorte.
 *  - **Filtro de mesa**: mostra só os pedidos de uma mesa; as mesas com pedido
 *    vivo aparecem como chips no topo da lista, que é o "por mesa" do escopo.
 *  - **Cards**: um pedido por card, ação principal grande no rodapé do card.
 *
 * Tempo real: assinatura de `orders` e `order_status_events`; o evento dispara
 * uma releitura da lista (fonte de verdade), nunca polling.
 */
export function OrdersPanel({
  restaurantId,
  timeZone,
  initialPending,
  initialTab,
}: {
  restaurantId: string;
  timeZone: string;
  /** Contagem inicial vinda do servidor, para o painel abrir já com número. */
  initialPending: number;
  /** Aba pedida pela URL (`/app/pedidos?tab=ready`). */
  initialTab?: PanelTab | null;
}) {
  const { active, done, loading, loadingMore, hasMoreDone, refresh, loadMoreDone, historyFor } =
    usePanelOrders();

  // Ordem de prioridade: o que a URL pediu (toque no dashboard) > pedido novo
  // esperando > "em preparo" (a fila que a cozinha acompanha o dia todo).
  const [tab, setTab] = useState<PanelTab>(
    initialTab ?? (initialPending > 0 ? "new" : "preparing"),
  );
  const [tableFilter, setTableFilter] = useState<string | null>(null);
  const [detail, setDetail] = useState<PanelOrder | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PanelOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ---------------------------------------------------------------- som */
  const [sound, setSound] = useState<"on" | "muted" | "blocked">("on");
  const [soundReady, setSoundReady] = useState(false);

  useEffect(() => {
    setSound(readSoundPreference());
  }, []);

  const enableSound = async () => {
    const state = await primeAudio();
    setSoundReady(true);
    if (state === "blocked") {
      setSound("blocked");
      return;
    }
    setSound("on");
    saveSoundPreference("on");
    // Confirma que o som funciona — sem isso a pessoa liga e nunca sabe se ligou.
    playNewOrderSound();
  };

  const muteSound = () => {
    setSound("muted");
    saveSoundPreference("muted");
  };

  /* ----------------------------------------------------------- alertas */
  /** Pedido que acabou de chegar e ainda não foi visto. */
  const [alert, setAlert] = useState<PanelOrder | null>(null);
  /** Pedidos que piscam por 8s depois de chegar. */
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const knownIds = useRef<Set<string> | null>(null);

  /* ------------------------------------------------------- tempo real */
  const onRealtimeChange = useCallback(() => {
    void refresh();
  }, [refresh]);

  const { state: realtimeState } = useOrdersRealtime({
    restaurantId,
    onChange: onRealtimeChange,
  });

  /**
   * Detecta pedido novo comparando a lista atual com a anterior.
   *
   * Fazemos isso sobre o resultado da releitura (e não sobre o payload do
   * evento) porque o evento não traz itens nem nome da mesa — e porque um
   * pedido pode chegar enquanto a aba está dormindo, sem evento nenhum.
   */
  useEffect(() => {
    if (loading) return;

    const pending = active.filter((order) => order.status === "pending");
    const ids = new Set(active.map((order) => order.id));

    if (knownIds.current === null) {
      // Primeira carga: nada é "novo", senão a tela apitava ao abrir.
      knownIds.current = ids;
      return;
    }

    const fresh = pending.filter((order) => !knownIds.current!.has(order.id));
    knownIds.current = ids;

    if (fresh.length === 0) return;

    const newest = fresh.sort((a, b) => b.order_number - a.order_number)[0] ?? null;
    setAlert(newest);
    setFlashing(new Set(fresh.map((order) => order.id)));

    if (sound === "on") playNewOrderSound();
    vibrateNewOrder();
    if (newest) setTab("new");

    const timer = window.setTimeout(() => setFlashing(new Set()), 8000);
    return () => window.clearTimeout(timer);
  }, [active, loading, sound]);

  /* ------------------------------------------------------------- ações */
  const advance = async (order: PanelOrder, status: OrderStatus) => {
    setBusyId(order.id);
    setError(null);
    const result = await setOrderStatus({ orderId: order.id, status });

    if (result.ok === false) {
      setError(result.error);
      setBusyId(null);
      // A lista pode estar defasada: relê para o painel não insistir no erro.
      void refresh();
      return;
    }

    setBusyId(null);
    setAlert((current) => (current?.id === order.id ? null : current));
    setDetail((current) =>
      current && current.id === order.id ? { ...current, status: result.status } : current,
    );
    await refresh();
  };

  const cancel = async (order: PanelOrder) => {
    setBusyId(order.id);
    const result = await setOrderStatus({ orderId: order.id, status: "cancelled" });
    setBusyId(null);

    if (result.ok === false) {
      setError(result.error);
      return;
    }
    setAlert((current) => (current?.id === order.id ? null : current));
    setDetail(null);
    await refresh();
  };

  /* --------------------------------------------------------- filtros */
  const tabDef = PANEL_TABS.find((item) => item.id === tab) ?? PANEL_TABS[0]!;

  const source = useMemo(() => {
    if (tab === "done") return done;
    return active.filter((order) => tabDef.statuses.includes(order.status));
  }, [tab, tabDef, active, done]);

  /** Mesas com pedido vivo: o "por mesa" do escopo, sem tela separada. */
  const tablesWithOrders = useMemo(() => {
    const map = new Map<string, { table_name: string; count: number }>();
    for (const order of active) {
      const entry = map.get(order.table_id) ?? { table_name: order.table_name, count: 0 };
      entry.count += 1;
      map.set(order.table_id, entry);
    }
    return [...map.entries()]
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => a.table_name.localeCompare(b.table_name, "pt-BR"));
  }, [active]);

  const visible = tableFilter
    ? source.filter((order) => order.table_id === tableFilter)
    : source;

  const counts = useMemo(() => {
    return {
      new: active.filter((order) => order.status === "pending").length,
      preparing: active.filter(
        (order) => order.status === "confirmed" || order.status === "preparing",
      ).length,
      ready: active.filter((order) => order.status === "ready").length,
      done: done.length,
    };
  }, [active, done]);

  const doneStatusLabel = (status: OrderStatus) => ORDER_STATUS_BOARD_LABEL[status];

  return (
    <div className="pb-4">
      {/* ------------------------------------------------- notificação */}
      {realtimeState === "offline" && (
        <div
          role="status"
          className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900"
        >
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Sem conexão em tempo real. Os pedidos aparecem ao tocar em{" "}
            <button
              type="button"
              onClick={() => void refresh()}
              className="font-semibold underline underline-offset-2"
            >
              atualizar
            </button>
            .
          </span>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      {/* Pedido novo: banner com número, mesa e total */}
      {alert && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-3 overflow-hidden rounded-2xl border border-red-200 bg-red-50 shadow-[var(--shadow-soft)]"
        >
          <div className="flex items-start gap-2.5 px-3.5 py-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-red-100 text-red-700">
              <BellRing className="size-5 animate-[ring_1s_ease-in-out_2]" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.7rem] font-bold uppercase tracking-wide text-red-700">
                Novo pedido recebido
              </p>
              <p className="mt-0.5 text-sm font-semibold text-ink-900">
                #{alert.order_number} · {alert.table_name}
              </p>
              <p className="text-xs text-ink-500">
                {alert.item_count} {alert.item_count === 1 ? "item" : "itens"} ·{" "}
                {formatTotal(alert.total)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAlert(null)}
              className="tap-target -mr-1.5 -mt-1 grid size-9 shrink-0 place-items-center rounded-lg text-red-700 hover:bg-red-100"
              aria-label="Dispensar alerta de novo pedido"
            >
              <ChevronRight className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex gap-2 border-t border-red-200 bg-white px-3 py-2">
            <Button
              size="md"
              className="min-w-0 flex-1"
              loading={busyId === alert.id}
              onClick={() => void advance(alert, "confirmed")}
            >
              Confirmar pedido
            </Button>
            <Button
              size="md"
              variant="secondary"
              className="shrink-0"
              onClick={() => setDetail(alert)}
            >
              Ver
            </Button>
          </div>
        </div>
      )}

      {/* -------------------------------------- solicitações da mesa (E8) */}
      {/*
        Acima das abas de propósito: quem chamou o garçom ou pediu a conta
        está esperando AGORA, e a lista de pedidos já tem sua própria
        prioridade (novos primeiro). A seção some sozinha quando a fila zera.
      */}
      <RequestsPanelHost restaurantId={restaurantId} />

      {/* ---------------------------------------------------- som */}
      <div className="mb-3 flex items-center gap-2">
        {sound === "on" ? (
          <button
            type="button"
            onClick={muteSound}
            className="tap-target inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 text-xs font-semibold text-brand-700"
          >
            <Volume2 className="size-4" aria-hidden="true" />
            Som ativado
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void enableSound()}
            className="tap-target inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-3 text-xs font-semibold text-ink-700"
          >
            <VolumeX className="size-4" aria-hidden="true" />
            {sound === "blocked" ? "Toque para liberar o som" : "Ativar som"}
          </button>
        )}

        {sound === "blocked" && soundReady && (
          <span className="text-[0.7rem] leading-tight text-ink-400">
            O navegador só libera áudio depois de um toque.
          </span>
        )}

        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 text-[0.7rem] font-medium",
            realtimeState === "live" ? "text-brand-700" : "text-ink-400",
          )}
          aria-live="polite"
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              realtimeState === "live" ? "bg-brand-500" : "bg-ink-300",
            )}
            aria-hidden="true"
          />
          {realtimeState === "live" ? "Tempo real" : "Conectando…"}
          <span className="sr-only">(atualização automática de pedidos)</span>
        </span>
      </div>

      {/* ------------------------------------------------ abas de status */}
      <div
        className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Filtrar pedidos por etapa"
      >
        <div className="flex w-max gap-1.5 pb-1">
          {PANEL_TABS.map((item) => {
            const activeTab = tab === item.id;
            const count = counts[item.id];
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={activeTab}
                onClick={() => setTab(item.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[0.82rem] font-semibold transition-colors",
                  "min-h-11",
                  activeTab
                    ? "bg-ink-900 text-white"
                    : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200",
                )}
              >
                {item.label}
                <span
                  className={cn(
                    "grid min-w-5 place-items-center rounded-full px-1 text-[0.7rem] font-bold tabular-nums",
                    activeTab ? "bg-white/20 text-white" : "bg-ink-100 text-ink-600",
                    item.id === "new" && count > 0 && !activeTab && "bg-red-100 text-red-700",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------- filtro de mesa */}
      {tablesWithOrders.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTableFilter(null)}
            aria-pressed={tableFilter === null}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              tableFilter === null
                ? "bg-brand-600 text-white"
                : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200",
            )}
          >
            Todas as mesas
          </button>
          {tablesWithOrders.map((table) => (
            <button
              key={table.id}
              type="button"
              onClick={() => setTableFilter(table.id)}
              aria-pressed={tableFilter === table.id}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                tableFilter === table.id
                  ? "bg-brand-600 text-white"
                  : "bg-white text-ink-600 ring-1 ring-inset ring-ink-200",
              )}
            >
              {table.table_name}
              <span className="ml-1 tabular-nums opacity-70">{table.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------- lista */}
      <div className="mt-3" role="tabpanel" aria-label={`Pedidos: ${tabDef.label}`}>
        {loading ? (
          <div className="space-y-2.5" aria-busy="true" aria-label="Carregando pedidos">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-40 animate-pulse rounded-2xl border border-ink-200/70 bg-white"
              />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState tab={tab} tableFilter={tableFilter} />
        ) : (
          <ul className="stagger space-y-2.5">
            {visible.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                highlight={flashing.has(order.id)}
                busy={busyId === order.id}
                onOpen={() => setDetail(order)}
                onAdvance={() => {
                  const next = nextStatusOf(order, doneStatusLabel);
                  if (next) void advance(order, next);
                }}
                onCancel={() => setCancelTarget(order)}
              />
            ))}
          </ul>
        )}

        {/* Histórico: carrega sob demanda */}
        {tab === "done" && !loading && (
          <div className="mt-3">
            {hasMoreDone ? (
              <Button
                variant="secondary"
                size="md"
                block
                loading={loadingMore}
                onClick={() => void loadMoreDone()}
              >
                <ArrowDown className="size-4" aria-hidden="true" />
                Carregar pedidos anteriores
              </Button>
            ) : (
              visible.length > 0 && (
                <p className="text-center text-xs text-ink-400">
                  Fim do histórico carregado. Pedidos antigos ficam no banco.
                </p>
              )
            )}
          </div>
        )}
      </div>

      {/* Atualizar manual: existe para quando o tempo real cai, não como rotina */}
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={() => void refresh()}
          className="tap-target inline-flex items-center gap-1.5 rounded-full px-3 text-xs font-medium text-ink-400 hover:text-ink-600"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Atualizar agora
        </button>
      </div>

      {/* Detalhe */}
      <OrderDetailSheet
        order={detail}
        timeZone={timeZone}
        fetchHistory={historyFor}
        onClose={() => setDetail(null)}
        onAdvance={() => {
          if (!detail) return;
          const next = nextStatusOf(detail, doneStatusLabel);
          if (next) void advance(detail, next);
        }}
        onCancel={() => {
          if (detail) setCancelTarget(detail);
        }}
      />

      {/* Cancelar: ação destrutiva pede confirmação */}
      <ConfirmSheet
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title={`Cancelar o pedido #${cancelTarget?.order_number ?? ""}?`}
        description={
          <>
            O pedido sai do fluxo e a mesa é avisada. O registro fica no histórico e não pode ser
            desfeito.
          </>
        }
        confirmLabel="Cancelar pedido"
        onConfirm={async () => {
          if (cancelTarget) await cancel(cancelTarget);
        }}
      />
    </div>
  );
}

/** Próximo status do fluxo, ou null quando não há ação. */
function nextStatusOf(order: PanelOrder, _label: (status: OrderStatus) => string) {
  const map: Partial<Record<OrderStatus, OrderStatus>> = {
    pending: "confirmed",
    confirmed: "preparing",
    preparing: "ready",
    ready: "delivered",
  };
  return map[order.status] ?? null;
}

function formatTotal(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function EmptyState({ tab, tableFilter }: { tab: PanelTab; tableFilter: string | null }) {
  const copy: Record<PanelTab, { title: string; description: string }> = {
    new: {
      title: "Nenhum pedido novo",
      description: "Quando um cliente enviar um pedido, ele aparece aqui na hora.",
    },
    preparing: {
      title: "Nada em preparo",
      description: "Confirme um pedido novo para ele entrar na cozinha.",
    },
    ready: {
      title: "Nada pronto esperando",
      description: "Pedidos marcados como prontos ficam aqui até a entrega.",
    },
    done: {
      title: "Nenhum pedido finalizado",
      description: "Entregues e cancelados aparecem aqui, do mais recente para o mais antigo.",
    },
  };

  const { title, description } = copy[tab];

  return (
    <div className="rounded-2xl border border-dashed border-ink-300 bg-white px-5 py-9 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-ink-100 text-ink-400">
        <ClipboardList className="size-6" aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-semibold text-ink-800">
        {tableFilter ? "Nada nesta mesa agora" : title}
      </p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-ink-500">{description}</p>
      {tableFilter && (
        <p className="mt-2 text-xs text-ink-400">
          Limpe o filtro de mesa ao lado para ver todas.
        </p>
      )}
    </div>
  );
}
