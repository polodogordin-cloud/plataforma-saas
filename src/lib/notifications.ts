/**
 * Regra de notificação — módulo neutro (cliente e servidor).
 *
 * Nada aqui toca banco, `server-only` ou `next/*`: é o que a tela precisa para
 * desenhar o sino e o painel, e o que os testes conseguem exercitar sem
 * infraestrutura.
 *
 * ─── O que NÃO está aqui, de propósito ──────────────────────────────────────
 *
 * Nenhuma função decide se uma notificação deve existir. Quem decide é o banco
 * (`notify_restaurant_staff`, com as preferências): se o app pudesse "emitir",
 * a autorização viveria no cliente. Este módulo só **apresenta** o que já foi
 * decidido.
 */

/** Tipos de notificação — espelham o enum `notification_type` do banco. */
export const NOTIFICATION_TYPES = [
  "order_created",
  "order_cancelled",
  "order_ready",
  "order_delivered",
  "table_waiter_called",
  "table_bill_requested",
  "payment_received",
  "payment_failed",
  "subscription_expiring",
  "subscription_expired",
  "customer_created",
  "coupon_expiring",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Entidades de destino — espelham `notification_entity`. */
export const NOTIFICATION_ENTITIES = [
  "order",
  "table_request",
  "payment",
  "subscription",
  "customer",
  "coupon",
] as const;

export type NotificationEntity = (typeof NOTIFICATION_ENTITIES)[number];

/** Linha da central como a tela recebe. */
export type Notification = {
  id: string;
  restaurant_id: string | null;
  type: NotificationType;
  title: string;
  message: string;
  entity_type: NotificationEntity | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
  /** Notificação global (master admin): sem casa e sem destinatário. */
  is_global: boolean;
};

/** Item do catálogo de preferências. */
export type NotificationPreferenceItem = {
  type: NotificationType;
  label: string;
  group: string;
};

/** Agrupamento do catálogo, na ordem em que a tela mostra. */
export const PREFERENCE_GROUP_ORDER = [
  "Pedidos",
  "Salão",
  "Pagamentos",
  "Assinatura",
  "Clientes",
  "Marketing",
] as const;

/**
 * Agrupa o catálogo para o formulário.
 *
 * A ordem vem de `PREFERENCE_GROUP_ORDER`, e não da ordem de chegada do banco:
 * o formulário precisa ser estável entre renders, senão os switches trocam de
 * posição quando a pessoa salva.
 */
export function groupPreferences(
  catalog: NotificationPreferenceItem[],
): Array<{ group: string; items: NotificationPreferenceItem[] }> {
  const byGroup = new Map<string, NotificationPreferenceItem[]>();

  for (const item of catalog) {
    const list = byGroup.get(item.group) ?? [];
    list.push(item);
    byGroup.set(item.group, list);
  }

  return PREFERENCE_GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => ({
    group,
    items: byGroup.get(group) ?? [],
  }));
}

/* -------------------------------------------------------------------------- */
/* Textos                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Rótulo do tipo.
 *
 * Existe porque a notificação antiga pode chegar com um tipo que a tela não
 * conhece (banco mais novo que o deploy). Nesse caso o título que o banco já
 * gravou é o que aparece — este rótulo é só o agrupador visual.
 */
export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  order_created: "Novo pedido",
  order_cancelled: "Pedido cancelado",
  order_ready: "Pedido pronto",
  order_delivered: "Pedido entregue",
  table_waiter_called: "Garçom chamado",
  table_bill_requested: "Conta pedida",
  payment_received: "Pagamento",
  payment_failed: "Pagamento",
  subscription_expiring: "Assinatura",
  subscription_expired: "Assinatura",
  customer_created: "Cliente",
  coupon_expiring: "Cupom",
};

/**
 * Ícone por família — string, não componente.
 *
 * Este módulo é neutro e não importa `lucide-react`; a tela mapeia a string
 * para o ícone. Também serve para o teste afirmar que cada tipo tem um ícone,
 * sem montar React.
 */
export const NOTIFICATION_ICON_KEY: Record<NotificationType, string> = {
  order_created: "receipt",
  order_cancelled: "receipt-off",
  order_ready: "check",
  order_delivered: "check-check",
  table_waiter_called: "bell",
  table_bill_requested: "receipt-text",
  payment_received: "wallet",
  payment_failed: "wallet-off",
  subscription_expiring: "calendar-clock",
  subscription_expired: "calendar-x",
  customer_created: "user-plus",
  coupon_expiring: "ticket",
};

/** Cor de destaque do item, pelo peso do assunto. */
export const NOTIFICATION_TONE: Record<NotificationType, "brand" | "success" | "warning" | "danger"> = {
  order_created: "brand",
  order_cancelled: "danger",
  order_ready: "success",
  order_delivered: "success",
  table_waiter_called: "warning",
  table_bill_requested: "warning",
  payment_received: "success",
  payment_failed: "danger",
  subscription_expiring: "warning",
  subscription_expired: "danger",
  customer_created: "brand",
  coupon_expiring: "warning",
};

/* -------------------------------------------------------------------------- */
/* Rota de destino                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Para onde o toque leva.
 *
 * Um caminho só de leitura, derivado do que o banco gravou. Se a entidade não
 * tiver tela (ou tiver sido apagada), devolve `null` e o item é só informativo
 * — melhor do que levar para uma página 404 e fazer a pessoa achar que o
 * sistema quebrou.
 *
 * O mesmo `entity_type` leva a lugares diferentes conforme quem está logado:
 * o dono do restaurante e o admin da plataforma não compartilham telas. Por
 * isso a função recebe `scope` em vez de tentar adivinhar pelo id.
 *
 * Não existe tela de pagamento individual nem no painel do dono nem no master:
 * a entidade `payment` aponta para a lista (plano/fila), que é onde a pessoa
 * consegue agir.
 */
export function notificationHref(
  notification: {
    entity_type: NotificationEntity | null;
    entity_id: string | null;
    restaurant_id: string | null;
    is_global?: boolean;
  },
  scope: "restaurant" | "platform" = "restaurant",
): string | null {
  if (scope === "platform") {
    // Notificação global: a única fila que o master abre por causa dela.
    return "/admin/pagamentos";
  }

  const { entity_type, entity_id } = notification;
  if (!entity_type || !entity_id) return null;

  switch (entity_type) {
    case "order":
      return `/app/pedidos?pedido=${entity_id}`;
    case "table_request":
      return `/app/pedidos?aba=salao`;
    case "subscription":
      return "/app/plano";
    case "customer":
      return `/app/clientes/${entity_id}`;
    case "coupon":
      return "/app/marketing/cupons";
    case "payment":
      // Não há tela de pagamento individual no painel do restaurante; a fila
      // de cobranças da assinatura é a mais próxima do assunto.
      return "/app/plano";
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Tempo                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Diferença em minutos entre duas datas, nunca negativa.
 *
 * Arredonda para o minuto mais próximo: 30 segundos vira "Agora", 1min30 vira
 * "Há 2 min". Truncar faria "Há 1 min" aparecer para algo de meio minuto.
 */
function minutesBetween(from: string, now: number): number {
  const started = new Date(from).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.round((now - started) / 60000));
}

/**
 * "Agora", "Há 3 min", "Há 2 h", "Ontem", "12/11".
 *
 * Notificação é sobre o presente: número exato de segundos não ajuda ninguém a
 * decidir se abre o pedido. A partir de dois dias, a data é mais útil que a
 * contagem — e é o que a pessoa usaria para procurar no histórico.
 */
export function relativeNotificationTime(iso: string, now: number = Date.now()): string {
  const minutes = minutesBetween(iso, now);

  if (minutes < 1) return "Agora";
  if (minutes < 60) return `Há ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Há ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Ontem";
  if (days < 7) return `Há ${days} dias`;

  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Hora absoluta para o `title` (toque longo / leitor de tela). */
export function notificationClock(iso: string, timeZone?: string | null): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timeZone ?? undefined,
    }).format(date);
  } catch {
    return date.toLocaleString("pt-BR");
  }
}

/* -------------------------------------------------------------------------- */
/* Contador e agrupamento                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Texto do contador do sino.
 *
 * `9+` acima de nove: o sino é um círculo de 18px e "12" já fica apertado. O
 * valor exato continua no rótulo acessível, para quem usa leitor de tela não
 * perder a informação.
 */
export function badgeText(count: number): string {
  if (count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}

/** Rótulo do sino, com o número por extenso. */
export function bellLabel(count: number): string {
  if (count <= 0) return "Notificações";
  return count === 1 ? "Notificações, 1 não lida" : `Notificações, ${count} não lidas`;
}

/** Quantas não lidas há numa lista (fallback quando o banco não manda o total). */
export function countUnread(items: Array<{ read_at: string | null }>): number {
  return items.reduce((sum, item) => (item.read_at === null ? sum + 1 : sum), 0);
}

/* -------------------------------------------------------------------------- */
/* Normalização da linha                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza a linha vinda da RPC.
 *
 * O tipo é conferido contra a lista conhecida: um enum novo no banco chegaria
 * como texto solto e cairia no `default` de todos os mapas de rótulo/ícone,
 * desenhando `undefined` na tela.
 */
export function normalizeNotification(row: Record<string, unknown>): Notification {
  const type = NOTIFICATION_TYPES.includes(row.type as NotificationType)
    ? (row.type as NotificationType)
    : "order_created";

  const entity =
    row.entity_type && NOTIFICATION_ENTITIES.includes(row.entity_type as NotificationEntity)
      ? (row.entity_type as NotificationEntity)
      : null;

  return {
    id: String(row.id),
    restaurant_id: row.restaurant_id ? String(row.restaurant_id) : null,
    type,
    title: String(row.title ?? "Notificação"),
    message: String(row.message ?? ""),
    entity_type: entity,
    entity_id: row.entity_id && entity ? String(row.entity_id) : null,
    read_at: row.read_at ? String(row.read_at) : null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    is_global: Boolean(row.is_global),
  };
}

/* -------------------------------------------------------------------------- */
/* Preparado e não entregue                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Canais de envio.
 *
 * **Nenhum está implementado.** Esta lista existe para o painel de preferências
 * poder dizer a verdade ("em breve") em vez de mostrar um switch que não faz
 * nada, e para a próxima etapa ter onde pendurar o dado sem migration nova.
 *
 * O que existe hoje é **só o sino dentro do painel**, alimentado por tempo real.
 */
export const NOTIFICATION_CHANNELS = [
  { id: "in_app", label: "No painel", state: "ready" },
  { id: "web_push", label: "Notificação no navegador", state: "planned" },
  { id: "email", label: "E-mail", state: "planned" },
  { id: "whatsapp", label: "WhatsApp", state: "planned" },
  { id: "sms", label: "SMS", state: "planned" },
] as const;

export type NotificationChannelId = (typeof NOTIFICATION_CHANNELS)[number]["id"];
export type NotificationChannelState = (typeof NOTIFICATION_CHANNELS)[number]["state"];
