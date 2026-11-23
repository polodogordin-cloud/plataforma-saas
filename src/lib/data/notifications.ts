import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  normalizeNotification,
  type Notification,
  type NotificationPreferenceItem,
} from "@/lib/notifications";

/**
 * Leitura da central de notificações — Etapa 26.
 *
 * Tudo passa por RPC `security definer` que confere o destinatário
 * (`auth.uid()`) e a casa (`is_restaurant_member`). O `restaurant_id` nunca vem
 * do navegador: quem manda é `getActiveRestaurant()` na página.
 */

export type NotificationPage = {
  notifications: Notification[];
  unread: number;
};

/**
 * Lista + contador numa chamada.
 *
 * A RPC devolve `unread_count` em cada linha justamente para o sino e a lista
 * não discordarem: duas consultas separadas abrem uma janela em que chega
 * notificação entre uma e outra, e o contador passa a mentir.
 */
export async function listNotifications({
  limit = 30,
  offset = 0,
  unreadOnly = false,
}: {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
} = {}): Promise<NotificationPage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_notifications", {
    p_limit: limit,
    p_offset: offset,
    p_unread_only: unreadOnly,
  });

  // Sem sessão ou sem permissão: vazio, não erro na tela.
  if (error || !data) return { notifications: [], unread: 0 };

  const rows = data as Array<Record<string, unknown>>;
  return {
    notifications: rows.map(normalizeNotification),
    // `unread_count` é o total do destinatário, não o da página: vem repetido em
    // cada linha, então basta o primeiro.
    unread: rows.length > 0 ? Number(rows[0]!.unread_count ?? 0) : 0,
  };
}

/** Só o número do sino — usado no layout, sem carregar linhas. */
export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unread_notification_count");

  if (error || data === null || data === undefined) return 0;
  const value = Number(data);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Preferências + catálogo rotulado.
 *
 * Ausência de linha no banco = tudo ligado. O catálogo vem do banco (e não de
 * uma constante no TypeScript) para o formulário listar exatamente os tipos que
 * o banco emite.
 */
export async function getNotificationPreferences(restaurantId: string): Promise<{
  disabled: string[];
  catalog: NotificationPreferenceItem[];
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_notification_preferences", {
    p_restaurant_id: restaurantId,
  });

  if (error || !data) return { disabled: [], catalog: [] };

  const row = (Array.isArray(data) ? data[0] : data) as
    | { disabled: string[] | null; catalog: NotificationPreferenceItem[] | null }
    | undefined;

  return {
    disabled: row?.disabled ?? [],
    catalog: row?.catalog ?? [],
  };
}

/**
 * Roda a revisão do dia (assinatura vencendo/vencida e cupons expirando).
 *
 * **Não é cron.** É chamada quando o dono abre o painel, e o próprio banco
 * impede duplicidade por dia. Inventar um worker que não existe faria o aviso
 * depender de uma peça de infraestrutura que ninguém mantém; chamar na abertura
 * garante que o dado que a pessoa está vendo é o de agora.
 *
 * Falhar aqui não pode quebrar o painel: a notificação é aviso, não conteúdo.
 */
export async function runNotificationReview(restaurantId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("run_notification_review", {
    p_restaurant_id: restaurantId,
  });

  if (error) {
    // Silencioso de propósito: quem não é membro recebe `notification_forbidden`
    // e o painel continua. O log ajuda no diagnóstico sem virar tela vermelha.
    console.warn("[notifications] revisão do dia não rodou:", error.message);
  }
}
