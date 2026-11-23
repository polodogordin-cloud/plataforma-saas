"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  BellRing,
  CalendarClock,
  CalendarX2,
  Check,
  CheckCheck,
  Loader2,
  Receipt,
  FileX2,
  ReceiptText,
  Settings2,
  Ticket,
  UserPlus,
  Wallet,
  WalletMinimal,
  WifiOff,
  X,
} from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import {
  NOTIFICATION_TONE,
  badgeText,
  bellLabel,
  notificationClock,
  notificationHref,
  relativeNotificationTime,
  type Notification,
  type NotificationType,
} from "@/lib/notifications";
import { useNotifications } from "@/components/notifications/use-notifications";
import { cn } from "@/lib/utils";

/**
 * Sino da central de notificações — Etapa 26.
 *
 * ─── Onde ele vive ─────────────────────────────────────────────────────────
 *
 * No cabeçalho de toda tela interna do painel (o layout de `/app` monta este
 * componente uma vez). Não é uma sétima aba do menu inferior: a barra já está
 * cheia e o sino precisa estar visível em **qualquer** tela, inclusive nas que
 * não têm aba (cardápio, configurações).
 *
 * ─── Contador otimista, verdade à vista ────────────────────────────────────
 *
 * O número vem do servidor na primeira pintura e do tempo real depois. Marcar
 * como lida mexe no contador na hora; se o servidor recusar, a releitura
 * devolve o valor certo. O número nunca é "inventado para baixo": ele só cai
 * quando a linha realmente muda de estado.
 *
 * ─── Painel como folha inferior ────────────────────────────────────────────
 *
 * No celular, uma folha que sobe (padrão do projeto). No desktop ela fica
 * ancorada à direita, mas o conteúdo é o mesmo — não há duas telas para manter.
 */
export function NotificationBell({
  userId,
  restaurantName,
  timeZone,
  initialUnread = 0,
  className,
}: {
  userId: string;
  restaurantName?: string | null;
  timeZone?: string | null;
  /**
   * Contagem lida no servidor (layout). O sino precisa nascer com o número
   * certo: um sino apagado na primeira pintura ensina a pessoa a não olhar.
   */
  initialUnread?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const {
    items,
    unread,
    loading,
    loadedOnce,
    state,
    error,
    busyId,
    markingAll,
    refresh,
    markRead,
    markAll,
    clearError,
  } = useNotifications({ userId, restaurantName, initialUnread });

  // Abrir o painel é o momento em que a lista precisa estar certa: o canal pode
  // ter perdido evento, e a pessoa está olhando. Uma releitura por abertura é
  // barata; polling no sino não é.
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const hasUnread = unread > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={bellLabel(unread)}
        aria-haspopup="dialog"
        className={cn(
          "tap-target relative grid size-10 place-items-center rounded-xl text-ink-600",
          "hover:bg-ink-100 active:scale-95 transition-transform",
          className,
        )}
      >
        {hasUnread ? (
          <BellRing className="size-5.5" aria-hidden="true" />
        ) : (
          <Bell className="size-5.5" aria-hidden="true" />
        )}

        {hasUnread && (
          <span
            // `aria-hidden`: o número já está no rótulo do botão; ler duas vezes
            // ("Notificações, 3 não lidas, 3") atrapalha o leitor de tela.
            aria-hidden="true"
            className={cn(
              "absolute -right-0.5 -top-0.5 grid min-w-[18px] place-items-center rounded-full px-1",
              "bg-red-600 text-[10px] font-bold leading-[18px] text-white",
            )}
          >
            {badgeText(unread)}
          </span>
        )}
      </button>

      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          clearError();
        }}
        title="Notificações"
        description={
          restaurantName ? `${restaurantName} · atualiza sozinho` : "Atualiza sozinho"
        }
        size="tall"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {/* ------------------------------------------------ barra de ações */}
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            <p className="text-xs text-ink-500">
              {state === "offline" ? (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <WifiOff className="size-3.5" aria-hidden="true" />
                  Sem tempo real — atualize para ver novas
                </span>
              ) : unread > 0 ? (
                `${unread} ${unread === 1 ? "não lida" : "não lidas"}`
              ) : (
                "Tudo lido"
              )}
            </p>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                className="tap-target rounded-lg px-2 text-xs font-semibold text-ink-500 hover:bg-ink-100 disabled:opacity-50"
              >
                {loading ? "Atualizando…" : "Atualizar"}
              </button>

              <button
                type="button"
                onClick={() => void markAll()}
                disabled={unread === 0 || markingAll}
                className="tap-target inline-flex items-center gap-1 rounded-lg px-2 text-xs font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-40"
              >
                {markingAll ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCheck className="size-3.5" aria-hidden="true" />
                )}
                Marcar lidas
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="mx-1 mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          {/* -------------------------------------------------- lista */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {!loadedOnce && loading ? (
              <SkeletonList />
            ) : items.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="space-y-1.5 pb-2">
                {items.map((item) => (
                  <NotificationRow
                    key={item.id}
                    notification={item}
                    timeZone={timeZone}
                    busy={busyId === item.id}
                    onRead={() => void markRead(item.id)}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* --------------------------------------------------- rodapé */}
          <div className="border-t border-ink-100 pt-2">
            <Link
              href="/app/notificacoes"
              onClick={() => setOpen(false)}
              className="tap-target flex items-center justify-center gap-1.5 rounded-xl text-xs font-semibold text-ink-500 hover:bg-ink-100"
            >
              <Settings2 className="size-3.5" aria-hidden="true" />
              O que eu quero receber
            </Link>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Item                                                                      */
/* -------------------------------------------------------------------------- */

function NotificationRow({
  notification,
  timeZone,
  busy,
  onRead,
  onNavigate,
}: {
  notification: Notification;
  timeZone?: string | null;
  busy: boolean;
  onRead: () => void;
  onNavigate: () => void;
}) {
  // Global = plataforma; o resto é da casa. A escolha vem do próprio dado
  // gravado, não de uma prop: uma notificação global aberta no painel do
  // restaurante não existe (a RLS impede), mas o oposto existe.
  const href = notificationHref(notification, notification.is_global ? "platform" : "restaurant");
  const unread = notification.read_at === null;
  const Icon = ICONS[notification.type] ?? Bell;
  const tone = TONE_CLASS[NOTIFICATION_TONE[notification.type] ?? "brand"];

  const body = (
    <>
      <span
        className={cn(
          "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl",
          tone.icon,
        )}
        aria-hidden="true"
      >
        <Icon className="size-4.5" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span
            className={cn(
              "min-w-0 text-sm leading-snug",
              unread ? "font-semibold text-ink-900" : "font-medium text-ink-700",
            )}
          >
            {notification.title}
          </span>
          <span
            className="shrink-0 pt-0.5 text-[11px] tabular-nums text-ink-400"
            title={notificationClock(notification.created_at, timeZone)}
          >
            {relativeNotificationTime(notification.created_at)}
          </span>
        </span>

        <span className="mt-0.5 block text-xs leading-snug text-ink-500">
          {notification.message}
        </span>

        {notification.is_global && (
          <span className="mt-1 inline-block rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
            Plataforma
          </span>
        )}
      </span>
    </>
  );

  const className = cn(
    "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors",
    unread ? "bg-brand-50/60" : "bg-white",
    "border",
    unread ? "border-brand-100" : "border-ink-100",
  );

  return (
    <li className="relative">
      <div className="flex items-stretch gap-1">
        {href ? (
          <Link href={href} onClick={onNavigate} className={cn(className, "active:bg-ink-50")}>
            {body}
          </Link>
        ) : (
          <div className={className}>{body}</div>
        )}

        {unread && (
          <button
            type="button"
            onClick={onRead}
            disabled={busy}
            aria-label={`Marcar "${notification.title}" como lida`}
            className="tap-target grid w-9 shrink-0 place-items-center rounded-xl text-ink-400 hover:bg-ink-100 disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Check className="size-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-ink-100 text-ink-400">
        <Bell className="size-6" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-ink-800">Nada por aqui</p>
      <p className="max-w-[16rem] text-xs leading-snug text-ink-500">
        Pedido novo, chamada de garçom, pagamento e aviso de assinatura aparecem neste espaço.
      </p>
    </div>
  );
}

function SkeletonList() {
  return (
    <ul className="space-y-1.5" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <li
          key={index}
          className="flex items-start gap-2.5 rounded-xl border border-ink-100 bg-white px-2.5 py-2.5"
        >
          <span className="size-9 shrink-0 animate-pulse rounded-xl bg-ink-100" />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className="block h-3 w-1/2 animate-pulse rounded bg-ink-100" />
            <span className="block h-2.5 w-4/5 animate-pulse rounded bg-ink-100" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Mapas de apresentação                                                     */
/* -------------------------------------------------------------------------- */

const ICONS: Record<NotificationType, typeof Bell> = {
  order_created: Receipt,
  order_cancelled: FileX2,
  order_ready: Check,
  order_delivered: CheckCheck,
  table_waiter_called: BellRing,
  table_bill_requested: ReceiptText,
  payment_received: Wallet,
  payment_failed: WalletMinimal,
  subscription_expiring: CalendarClock,
  subscription_expired: CalendarX2,
  customer_created: UserPlus,
  coupon_expiring: Ticket,
};

const TONE_CLASS: Record<"brand" | "success" | "warning" | "danger", { icon: string }> = {
  brand: { icon: "bg-brand-50 text-brand-700" },
  success: { icon: "bg-emerald-50 text-emerald-700" },
  warning: { icon: "bg-amber-50 text-amber-700" },
  danger: { icon: "bg-red-50 text-red-700" },
};

/** Ícone fechado para o painel usar em outro lugar (ex.: tela de preferências). */
export function NotificationTypeIcon({ type, className }: { type: NotificationType; className?: string }) {
  const Icon = ICONS[type] ?? Bell;
  return <Icon className={className} aria-hidden="true" />;
}

/** Botão de fechar do painel — exportado para o caso de tela cheia própria. */
export function CloseBellButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Fechar notificações"
      className="tap-target grid place-items-center rounded-xl text-ink-500 hover:bg-ink-100"
    >
      <X className="size-5" aria-hidden="true" />
    </button>
  );
}
