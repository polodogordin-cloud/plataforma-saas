"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { nfcTagSchema, toUuidOrNull, type ActionState } from "@/lib/validation";
import type { NfcStatus } from "@/lib/types";

/**
 * Ações de NFC.
 *
 * Tudo que acontece aqui é sobre a TAG e sobre a URL que vai ser gravada nela.
 * Nada de Web NFC: o navegador não grava NTAG de forma confiável, e prometer
 * isso quebraria a confiança do dono na primeira TAG falhada. O sistema
 * entrega a URL pronta e registra o que foi feito.
 *
 * `nfc_url` nunca é calculada aqui: a view `table_nfc_overview` já devolve o
 * caminho atual da mesa. Assim não existe uma segunda fonte de verdade para
 * (slug, token).
 */

const str = (value: FormDataEntryValue | null) => String(value ?? "").trim();

function fieldErrorsFrom(error: unknown): ActionState["fieldErrors"] | undefined {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues;
    const result: Record<string, string[]> = {};
    for (const issue of issues) {
      const key = String(issue.path[0] ?? "form");
      result[key] = [...(result[key] ?? []), issue.message];
    }
    return result;
  }
  return undefined;
}

/** Mesma regra das mesas: owner/admin. Verificado no servidor. */
async function requireNfcEditor() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { error: "Restaurante não encontrado." as const };

  if (restaurant.role !== "owner" && restaurant.role !== "admin") {
    return { error: "Seu perfil não tem permissão para gerenciar o NFC." as const };
  }
  return { restaurant };
}

function revalidateNfc(tableId?: string) {
  revalidatePath("/app/mesas");
  if (tableId) revalidatePath(`/app/mesas/${tableId}/nfc`);
  revalidatePath("/app", "layout");
}

function friendlyError(error: { code?: string; message?: string } | null) {
  if (!error) return null;
  if (error.code === "23505" && error.message?.includes("table_nfc_tags_identifier_key")) {
    return "Já existe uma TAG com esse identificador neste restaurante.";
  }
  if (error.message?.includes("table_not_found")) {
    return "Mesa não encontrada neste restaurante.";
  }
  if (error.code === "23505") return "Este valor já está em uso.";
  if (error.code === "42501") return "Seu perfil não tem permissão para esta ação.";
  return null;
}

/**
 * Confirma que a mesa é do restaurante do usuário.
 * A RLS já impede ver mesa alheia; isto devolve mensagem clara em vez de
 * "salvo" silencioso.
 */
async function ownedTable(tableId: string, restaurantId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tables")
    .select("id, name")
    .eq("id", tableId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  return data as { id: string; name: string } | null;
}

/* -------------------------------------------------------------------------- */
/* Criar / editar TAG                                                         */
/* -------------------------------------------------------------------------- */

export async function createNfcTag(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = nfcTagSchema.safeParse({
    label: str(formData.get("label")),
    tagIdentifier: str(formData.get("tagIdentifier")),
    status: str(formData.get("status")) || "not_configured",
    isActive: formData.get("isActive") !== "off",
    tableId: str(formData.get("tableId")),
  });

  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };

  const guard = await requireNfcEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const table = await ownedTable(parsed.data.tableId, guard.restaurant.id);
  if (!table) return { ok: false, message: "Mesa não encontrada." };

  const supabase = await createClient();
  const { error } = await supabase.from("table_nfc_tags").insert({
    restaurant_id: guard.restaurant.id,
    table_id: parsed.data.tableId,
    label: parsed.data.label || null,
    tag_identifier: parsed.data.tagIdentifier || null,
    status: parsed.data.status,
    is_active: parsed.data.isActive,
  });

  if (error) {
    const friendly = friendlyError(error);
    return {
      ok: false,
      message: friendly ?? "Não foi possível cadastrar a TAG.",
      fieldErrors: friendly ? { tagIdentifier: [friendly] } : undefined,
    };
  }

  revalidateNfc(parsed.data.tableId);
  return { ok: true, message: "TAG cadastrada." };
}

export async function updateNfcTag(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const tagId = toUuidOrNull(formData.get("tagId"));
  if (!tagId) return { ok: false, message: "TAG não identificada." };

  const parsed = nfcTagSchema.safeParse({
    label: str(formData.get("label")),
    tagIdentifier: str(formData.get("tagIdentifier")),
    status: str(formData.get("status")) || "not_configured",
    isActive: formData.get("isActive") !== "off",
    tableId: str(formData.get("tableId")),
    tagId,
  });

  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };

  const guard = await requireNfcEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const table = await ownedTable(parsed.data.tableId, guard.restaurant.id);
  if (!table) return { ok: false, message: "Mesa não encontrada." };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("table_nfc_tags")
    .update({
      label: parsed.data.label || null,
      tag_identifier: parsed.data.tagIdentifier || null,
      status: parsed.data.status,
      is_active: parsed.data.isActive,
    })
    // O filtro por restaurant_id é o que impede editar TAG de outro tenant,
    // mesmo que alguém envie um tagId de fora pelo formulário.
    .eq("id", tagId)
    .eq("restaurant_id", guard.restaurant.id)
    .eq("table_id", parsed.data.tableId)
    .select("id");

  if (error) {
    const friendly = friendlyError(error);
    return {
      ok: false,
      message: friendly ?? "Não foi possível salvar a TAG.",
      fieldErrors: friendly ? { tagIdentifier: [friendly] } : undefined,
    };
  }
  if (!data?.length) return { ok: false, message: "TAG não encontrada." };

  revalidateNfc(parsed.data.tableId);
  return { ok: true, message: "TAG atualizada." };
}

/**
 * Mudança rápida de status, usada pelos botões grandes do card.
 *
 * Marcar como "configurado" é o gesto central da etapa: o dono gravou a URL
 * com o app de terceiros e está dizendo ao sistema que a TAG já aponta para
 * cá. Marcar como "testado" vai um passo além — alguém encostou o celular e
 * o cardápio abriu.
 */
export async function setNfcStatus(
  tagId: string,
  status: NfcStatus,
  tableId: string,
): Promise<ActionState> {
  const id = toUuidOrNull(tagId);
  const table = toUuidOrNull(tableId);
  if (!id || !table) return { ok: false, message: "TAG não identificada." };

  const allowed: NfcStatus[] = ["not_configured", "configured", "tested", "disabled"];
  if (!allowed.includes(status)) return { ok: false, message: "Status inválido." };

  const guard = await requireNfcEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("table_nfc_tags")
    .update({ status })
    .eq("id", id)
    .eq("restaurant_id", guard.restaurant.id)
    .eq("table_id", table)
    .select("id");

  if (error || !data?.length) {
    return { ok: false, message: friendlyError(error) ?? "Não foi possível atualizar a TAG." };
  }

  revalidateNfc(table);
  return { ok: true, message: "Status atualizado." };
}

/** Liga/desliga a TAG sem perder o histórico nem exigir apagar a linha. */
export async function toggleNfcTag(
  tagId: string,
  isActive: boolean,
  tableId: string,
): Promise<ActionState> {
  const id = toUuidOrNull(tagId);
  const table = toUuidOrNull(tableId);
  if (!id || !table) return { ok: false, message: "TAG não identificada." };

  const guard = await requireNfcEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("table_nfc_tags")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("restaurant_id", guard.restaurant.id)
    .eq("table_id", table)
    .select("id");

  if (error || !data?.length) {
    return { ok: false, message: friendlyError(error) ?? "Não foi possível atualizar a TAG." };
  }

  revalidateNfc(table);
  return { ok: true, message: isActive ? "TAG ativada." : "TAG desativada." };
}

/**
 * Substituição: a TAG nova nasce vinculada à antiga, e a antiga é desativada
 * em vez de apagada — o histórico continua legível.
 */
export async function replaceNfcTag(
  previousTagId: string,
  tableId: string,
): Promise<ActionState> {
  const previous = toUuidOrNull(previousTagId);
  const table = toUuidOrNull(tableId);
  if (!previous || !table) return { ok: false, message: "TAG não identificada." };

  const guard = await requireNfcEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const owned = await ownedTable(table, guard.restaurant.id);
  if (!owned) return { ok: false, message: "Mesa não encontrada." };

  const supabase = await createClient();

  // Confirma que a TAG antiga é do restaurante antes de encadear.
  const { data: old } = await supabase
    .from("table_nfc_tags")
    .select("id, label")
    .eq("id", previous)
    .eq("restaurant_id", guard.restaurant.id)
    .eq("table_id", table)
    .maybeSingle();

  if (!old) return { ok: false, message: "TAG não encontrada." };

  const { data: created, error } = await supabase
    .from("table_nfc_tags")
    .insert({
      restaurant_id: guard.restaurant.id,
      table_id: table,
      label: old.label ? `${old.label} (nova)` : null,
      status: "not_configured",
      is_active: true,
      replaced_tag_id: previous,
    })
    .select("id")
    .single();

  if (error || !created) {
    return { ok: false, message: friendlyError(error) ?? "Não foi possível substituir a TAG." };
  }

  await supabase
    .from("table_nfc_tags")
    .update({ is_active: false, status: "disabled" })
    .eq("id", previous)
    .eq("restaurant_id", guard.restaurant.id);

  revalidateNfc(table);
  return { ok: true, message: "TAG substituída." };
}

/** Remove a TAG do cadastro. O histórico sobrevive (tag_id vira null). */
export async function deleteNfcTag(tagId: string, tableId: string): Promise<ActionState> {
  const id = toUuidOrNull(tagId);
  const table = toUuidOrNull(tableId);
  if (!id || !table) return { ok: false, message: "TAG não identificada." };

  const guard = await requireNfcEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("table_nfc_tags")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", guard.restaurant.id)
    .eq("table_id", table)
    .select("id");

  if (error || !data?.length) {
    return { ok: false, message: "Não foi possível remover a TAG." };
  }

  revalidateNfc(table);
  return { ok: true, message: "TAG removida." };
}
