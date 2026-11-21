"use client";

import { BellRing, CheckCheck, Clock, Loader2, Receipt, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { orderAgeLabel, orderAgeLevel } from "@/lib/order-time";
import {
  TABLE_REQUEST_TYPE_BADGE,
  TABLE_REQUEST_TYPE_LABEL,
  type TableRequest,
} from "@/lib/types";

/**
 * Card de uma solicitação da mesa no painel.
 *
 * A informação que importa está aqui, na ordem em que o salão lê:
 *
 *   1. **o que é** (garçom / conta) — ícone + texto, não só cor;
 *   2. **de onde** — "Mesa 04";
 *   3. **há quanto tempo** — "Há 1 minuto", com a mesma escala de urgência dos
 *      pedidos (âmbar aos 8 min, vermelho aos 15);
 *   4. **a ação** — ATENDER e, depois, MARCAR COMO RESOLVIDO.
 *
 * O botão ocupa a largura toda do card e tem 44px+ de alvo: no salão se toca
 * com o polegar, andando, às vezes com a tela suja.
 */
export function TableRequestCard({
  request,
  busy,
  onAcknowledge,
  onResolve,
  now,
}: {
  request: TableRequest;
  busy: boolean;
  onAcknowledge: (request: TableRequest) => void;
  onResolve: (request: TableRequest) => void;
  /** Base de tempo injetável nos testes. */
  now?: number;
}) {
  const isWaiter = request.type === "waiter";
  const Icon = isWaiter ? BellRing : Receipt;
  const acknowledged = request.status === "acknowledged";
  const age = orderAgeLabel(request.created_at, now);
  const tone = orderAgeLevel(request.created_at, now);

  return (
    <li
      className={cn(
        "rounded-2xl border bg-white p-3.5 shadow-sm transition-colors",
        tone === "late"
          ? "border-red-300 bg-red-50/40"
          : tone === "warn"
            ? "border-amber-300 bg-amber-50/40"
            : "border-ink-200",
        acknowledged && "border-brand-300 bg-brand-50/40",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-xl",
            isWaiter ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800",
          )}
          aria-hidden="true"
        >
          <Icon className="size-5" strokeWidth={2.2} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="truncate text-[1.02rem] font-bold leading-tight text-ink-900">
              {request.table_name}
            </p>
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide",
                isWaiter ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800",
              )}
            >
              {TABLE_REQUEST_TYPE_BADGE[request.type]}
            </span>
          </div>

          <p className="mt-0.5 truncate text-sm text-ink-600">
            {TABLE_REQUEST_TYPE_LABEL[request.type]}
          </p>

          <p
            className={cn(
              "mt-1 flex items-center gap-1 text-xs font-medium",
              tone === "late"
                ? "text-red-700"
                : tone === "warn"
                  ? "text-amber-700"
                  : "text-ink-500",
            )}
          >
            <Clock className="size-3.5 shrink-0" aria-hidden="true" />
            <span>Há {age}</span>
            {acknowledged && (
              <span className="ml-1 rounded bg-brand-100 px-1.5 py-0.5 text-[0.65rem] font-bold text-brand-800">
                Atendendo
              </span>
            )}
          </p>

          {request.note && (
            <p className="mt-1.5 line-clamp-2 rounded-lg bg-ink-50 px-2 py-1.5 text-xs text-ink-700">
              “{request.note}”
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => (acknowledged ? onResolve(request) : onAcknowledge(request))}
        disabled={busy}
        className={cn(
          "mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold uppercase tracking-wide transition-transform active:scale-[0.98] disabled:opacity-60",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
          acknowledged
            ? "bg-brand-600 text-white focus-visible:outline-brand-700"
            : "bg-ink-900 text-white focus-visible:outline-ink-900",
        )}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : acknowledged ? (
          <CheckCheck className="size-4" aria-hidden="true" />
        ) : (
          <BellRing className="size-4" aria-hidden="true" />
        )}
        {acknowledged ? "Marcar como resolvido" : "Atender"}
      </button>
    </li>
  );
}

/**
 * Seção SOLICITAÇÕES do painel.
 *
 * Só aparece quando há algo na fila: um bloco permanente vazio ocuparia a
 * primeira dobra do salão sem dizer nada. Quando há, vem com contador
 * vermelho — "🔴 2 solicitações pendentes" — porque o que está esperando
 * precisa gritar.
 */
export function TableRequestsSection({
  requests,
  loading,
  realtimeState,
  busyId,
  onAcknowledge,
  onResolve,
  now,
}: {
  requests: TableRequest[];
  loading: boolean;
  realtimeState: "connecting" | "live" | "offline";
  busyId: string | null;
  onAcknowledge: (request: TableRequest) => void;
  onResolve: (request: TableRequest) => void;
  now?: number;
}) {
  if (!loading && requests.length === 0) return null;

  const pending = requests.filter((request) => request.status === "pending").length;

  return (
    <section aria-labelledby="requests-title" className="mt-5">
      <div className="flex items-center justify-between gap-2">
        <h2
          id="requests-title"
          className="text-xs font-bold uppercase tracking-wide text-ink-500"
        >
          Solicitações
        </h2>
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
            realtimeState === "live"
              ? "bg-brand-50 text-brand-700"
              : realtimeState === "offline"
                ? "bg-amber-50 text-amber-800"
                : "bg-ink-100 text-ink-500",
          )}
          aria-live="polite"
        >
          {realtimeState === "offline" ? (
            <WifiOff className="size-3" aria-hidden="true" />
          ) : (
            <span className="relative flex size-2">
              <span
                className={cn(
                  "size-2 rounded-full",
                  realtimeState === "live" ? "bg-brand-500" : "bg-ink-400",
                )}
              />
            </span>
          )}
          {realtimeState === "live"
            ? "Tempo real"
            : realtimeState === "offline"
              ? "Reconectando"
              : "Conectando"}
        </span>
      </div>

      {loading ? (
        <div className="mt-2 flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-3 py-3 text-sm text-ink-500">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Carregando solicitações…
        </div>
      ) : (
        <>
          <p
            className={cn(
              "mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold",
              pending > 0 ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-800",
            )}
            role="status"
            aria-live="polite"
          >
            <span aria-hidden="true">{pending > 0 ? "🔴" : "✅"}</span>
            {pending > 0
              ? `${pending} ${pending === 1 ? "solicitação pendente" : "solicitações pendentes"}`
              : "Nenhuma solicitação pendente"}
          </p>

          <ul className="mt-2 space-y-2">
            {requests.map((request) => (
              <TableRequestCard
                key={request.id}
                request={request}
                busy={busyId === request.id}
                onAcknowledge={onAcknowledge}
                onResolve={onResolve}
                now={now}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
