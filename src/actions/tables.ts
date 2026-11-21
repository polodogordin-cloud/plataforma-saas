"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { tableSchema, toUuidOrNull, type ActionState } from "@/lib/validation";
import type { TableStatus } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

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

const str = (value: FormDataEntryValue | null) => String(value ?? "").trim();

/**
 * Só owner/admin mexem no salão — verificado no servidor, não na tela.
 *
 * A RLS já bloquearia a escrita, mas o guard dá a mensagem certa antes de
 * qualquer ida ao banco e cobre o caso de a policy ser afrouxada por engano.
 */
async function requireTableEditor() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { error: "Restaurante não encontrado." as const };

  if (restaurant.role !== "owner" && restaurant.role !== "admin") {
    return { error: "Seu perfil não tem permissão para gerenciar mesas." as const };
  }
  return { restaurant };
}

/** Traduz o erro do PostgREST em mensagem de campo. */
function friendlyError(error: { code?: string; message?: string } | null) {
  if (!error) return null;
  if (error.code === "23505" && error.message?.includes("tables_restaurant_name_key")) {
    return "Já existe uma mesa com esse nome.";
  }
  if (error.code === "23505" && error.message?.includes("tables_restaurant_code_key")) {
    return "Já existe uma mesa com esse código.";
  }
  if (error.code === "23505") return "Este valor já está em uso.";
  if (error.message?.includes("public_token_immutable")) {
    return "O token da mesa não pode ser alterado por aqui.";
  }
  return null;
}

function revalidateTables() {
  revalidatePath("/app/mesas");
  revalidatePath("/app", "layout");
}

/* -------------------------------------------------------------------------- */
/* CRUD                                                                        */
/* -------------------------------------------------------------------------- */

export async function createTable(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = tableSchema.safeParse({
    name: str(formData.get("name")),
    code: str(formData.get("code")),
    notes: str(formData.get("notes")),
    isActive: !formData.has("isActive") ? true : formData.get("isActive") === "on",
    status: str(formData.get("status")) || undefined,
  });

  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };

  const guard = await requireTableEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error } = await supabase.from("tables").insert({
    restaurant_id: guard.restaurant.id,
    name: parsed.data.name,
    code: parsed.data.code || null,
    notes: parsed.data.notes || null,
    is_active: parsed.data.isActive,
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
  });

  if (error) {
    const friendly = friendlyError(error);
    if (friendly) return { ok: false, fieldErrors: { name: [friendly] } };
    return { ok: false, message: "Não foi possível criar a mesa." };
  }

  revalidateTables();
  return { ok: true, message: "Mesa criada." };
}

export async function updateTable(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const tableId = toUuidOrNull(formData.get("tableId"));
  if (!tableId) return { ok: false, message: "Mesa não identificada." };

  const parsed = tableSchema.safeParse({
    name: str(formData.get("name")),
    code: str(formData.get("code")),
    notes: str(formData.get("notes")),
    isActive: !formData.has("isActive") ? true : formData.get("isActive") === "on",
    status: str(formData.get("status")) || undefined,
  });

  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };

  const guard = await requireTableEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error, data: updated } = await supabase
    .from("tables")
    .update({
      name: parsed.data.name,
      code: parsed.data.code || null,
      notes: parsed.data.notes || null,
      is_active: parsed.data.isActive,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    })
    // O filtro por restaurant_id é o que impede editar mesa de outro tenant,
    // mesmo que alguém envie um tableId de fora pelo formulário.
    .eq("id", tableId)
    .eq("restaurant_id", guard.restaurant.id)
    .select("id");

  if (error) {
    const friendly = friendlyError(error);
    if (friendly) return { ok: false, fieldErrors: { name: [friendly] } };
    return { ok: false, message: "Não foi possível salvar a mesa." };
  }
  if (!updated?.length) return { ok: false, message: "Mesa não encontrada." };

  revalidateTables();
  return { ok: true, message: "Mesa atualizada." };
}

export async function deleteTable(tableId: string): Promise<ActionState> {
  const id = toUuidOrNull(tableId);
  if (!id) return { ok: false, message: "Mesa não identificada." };

  const guard = await requireTableEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error, data: deleted } = await supabase
    .from("tables")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", guard.restaurant.id)
    .select("id");

  if (error) return { ok: false, message: "Não foi possível excluir a mesa." };
  if (!deleted?.length) return { ok: false, message: "Mesa não encontrada." };

  revalidateTables();
  return { ok: true, message: "Mesa excluída." };
}

/** Ação rápida: ativar/desativar a mesa (controla o acesso público). */
export async function toggleTableActive(tableId: string, isActive: boolean) {
  const id = toUuidOrNull(tableId);
  if (!id) return { ok: false, message: "Mesa não identificada." };

  const guard = await requireTableEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("tables")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("restaurant_id", guard.restaurant.id)
    .select("id");

  if (error || !data?.length) {
    return { ok: false, message: "Não foi possível atualizar a mesa." };
  }

  revalidateTables();
  return { ok: true };
}

/** Ocupação do salão (Etapa 4 apenas registra; pedidos vêm na Etapa 6). */
export async function setTableStatus(tableId: string, status: TableStatus) {
  const id = toUuidOrNull(tableId);
  if (!id) return { ok: false, message: "Mesa não identificada." };

  const allowed: TableStatus[] = ["free", "occupied", "reserved", "inactive"];
  if (!allowed.includes(status)) return { ok: false, message: "Status inválido." };

  const guard = await requireTableEditor();
  if ("error" in guard) return { ok: false, message: guard.error };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("tables")
    .update({ status })
    .eq("id", id)
    .eq("restaurant_id", guard.restaurant.id)
    .select("id");

  if (error || !data?.length) {
    return { ok: false, message: "Não foi possível atualizar o status." };
  }

  revalidateTables();
  return { ok: true };
}

/**
 * Regenera o token da mesa.
 *
 * Isso muda a URL do QR Code e do NFC: todo material já impresso deixa de
 * funcionar. O banco mantém o token anterior válido por `graceMinutes` para
 * não derrubar quem está com o cardápio aberto neste instante.
 */
export async function rotateTableToken(tableId: string, graceMinutes = 30) {
  const id = toUuidOrNull(tableId);
  if (!id) return { ok: false as const, message: "Mesa não identificada." };

  const guard = await requireTableEditor();
  if ("error" in guard) return { ok: false as const, message: guard.error };

  const supabase = await createClient();

  // Confirma que a mesa é do restaurante do usuário antes da RPC. A RPC também
  // checa, mas assim a mensagem é precisa e não vaza existência de id alheio.
  const { data: owned } = await supabase
    .from("tables")
    .select("id")
    .eq("id", id)
    .eq("restaurant_id", guard.restaurant.id)
    .maybeSingle();

  if (!owned) return { ok: false as const, message: "Mesa não encontrada." };

  const { data, error } = await supabase.rpc("rotate_table_token", {
    p_table_id: id,
    p_grace_minutes: graceMinutes,
  });

  if (error) return { ok: false as const, message: "Não foi possível gerar um novo código." };

  const row = (Array.isArray(data) ? data[0] : data) as { public_token?: string } | undefined;
  if (!row?.public_token) {
    return { ok: false as const, message: "Não foi possível gerar um novo código." };
  }

  revalidateTables();
  return { ok: true as const, token: row.public_token };
}
