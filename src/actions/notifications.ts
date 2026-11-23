"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { saveNotificationPreferencesSchema } from "@/lib/validation";

/**
 * Ações da central de notificações — Etapa 26.
 *
 * ─── O que este arquivo NÃO faz ────────────────────────────────────────────
 *
 * Não cria notificação. Emitir aviso é consequência de um fato (pedido, chamada,
 * pagamento), e o banco é quem decide — inclusive quem recebe. Uma `create`
 * aqui daria à tela o poder de avisar outro usuário com texto arbitrário.
 *
 * ─── Por que o restaurante não vem daqui ───────────────────────────────────
 *
 * Em `savePreferences`, o id chega do formulário e é conferido pela RPC
 * (`is_restaurant_member`). Nas demais ações nem isso: `mark_notification_read`
 * e `mark_all_notifications_read` filtram por `auth.uid()` dentro do banco,
 * então um id forjado simplesmente não encontra linha.
 */

type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

/** Marca uma notificação como lida. */
export async function markNotificationRead(id: string): Promise<ActionResult<{ changed: number }>> {
  if (!id || typeof id !== "string") {
    return { ok: false, error: "Notificação inválida." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_notification_read", { p_id: id });

  if (error) {
    // `notification_id_required` vem de id nulo; `notification_forbidden` não
    // existe para esta RPC — notificação de outra pessoa apenas não é
    // encontrada, e devolver 0 é o comportamento correto.
    return { ok: false, error: "Não foi possível marcar a notificação." };
  }

  revalidatePath("/app", "layout");
  return { ok: true, data: { changed: Number(data ?? 0) } };
}

/**
 * Marca todas as minhas como lidas.
 *
 * Devolve quantas mudaram — a tela usa o número para anunciar "3 marcadas"
 * em vez de só sumir com o contador, que parece que nada aconteceu.
 */
export async function markAllNotificationsRead(): Promise<ActionResult<{ changed: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_all_notifications_read");

  if (error) {
    return { ok: false, error: "Não foi possível marcar as notificações." };
  }

  revalidatePath("/app", "layout");
  return { ok: true, data: { changed: Number(data ?? 0) } };
}

/**
 * Salva os tipos desligados.
 *
 * A validação de cada chave é do banco contra o enum: o formulário manda o que
 * a pessoa tocou, e o banco recusa tipo inexistente com `22023`. Aqui só se
 * confere o formato (array de strings, tamanho) para a mensagem de erro ser
 * legível.
 */
export async function saveNotificationPreferences(
  input: unknown,
): Promise<ActionResult<{ disabled: string[] }>> {
  const parsed = saveNotificationPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Preferências inválidas." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_notification_preferences", {
    p_restaurant_id: parsed.data.restaurantId,
    p_disabled: parsed.data.disabled,
  });

  if (error) {
    if (error.message.includes("notification_forbidden")) {
      return { ok: false, error: "Você não tem acesso a este restaurante." };
    }
    if (error.message.includes("unknown_notification_type")) {
      return { ok: false, error: "Tipo de notificação desconhecido. Recarregue a página." };
    }
    return { ok: false, error: "Não foi possível salvar as preferências." };
  }

  revalidatePath("/app/notificacoes");
  return { ok: true, data: { disabled: parsed.data.disabled } };
}
