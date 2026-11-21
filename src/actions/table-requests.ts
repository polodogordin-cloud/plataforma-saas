"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { listTableRequests, tableRequestCounts } from "@/lib/data/table-requests";
import type {
  CreatedTableRequest,
  TableRequest,
  TableRequestState,
  TableRequestStatus,
  TableRequestType,
} from "@/lib/types";

/**
 * Solicitações da mesa — Etapa 8.
 *
 * Lado do cliente: ele nunca manda `table_id`. Só o token da mesa, que é
 * revalidado no banco por `resolve_table_token`. Lado do restaurante: toda
 * alteração passa por RPC que confere vínculo de equipe e RLS nas tabelas.
 */

const tokenSchema = z
  .string()
  .trim()
  .regex(/^[2-9A-HJKMNP-Z]{10,64}$/i, "Mesa não identificada.");

const createSchema = z.object({
  tableToken: tokenSchema,
  type: z.enum(["waiter", "bill"]),
  note: z.string().trim().max(200, "A observação é longa demais.").optional(),
});

export type CreateTableRequestResult =
  | { ok: true; request: CreatedTableRequest }
  | { ok: false; error: string; code: "cooldown" | "unavailable" | "unknown" };

type FailureCode = "cooldown" | "unavailable" | "unknown";

/** Mensagens da RPC traduzidas para o cliente final. */
function translate(message: string | undefined): { error: string; code: FailureCode } {
  if (message?.includes("request_cooldown")) {
    return {
      error: "Solicitação já enviada. Aguarde um instante antes de chamar de novo.",
      code: "cooldown",
    };
  }
  if (message?.includes("table_unavailable")) {
    return {
      error: "Esta mesa não está disponível. Chame um atendente no salão.",
      code: "unavailable",
    };
  }
  if (message?.includes("note_too_long")) {
    return { error: "A observação é longa demais.", code: "unknown" };
  }
  return { error: "Não foi possível enviar a solicitação. Tente novamente.", code: "unknown" };
}

export async function createTableRequest(input: unknown): Promise<CreateTableRequestResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      code: "unknown",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_table_request", {
    p_token: parsed.data.tableToken,
    p_type: parsed.data.type,
    p_note: parsed.data.note || null,
  });

  if (error) {
    return { ok: false, ...translate(error.message) };
  }

  const row = (Array.isArray(data) ? data[0] : data) as CreatedTableRequest | undefined;
  if (!row) {
    return { ok: false, error: "Não foi possível enviar a solicitação.", code: "unknown" };
  }

  return { ok: true, request: row };
}

/**
 * Situação da mesa — usado pela tela do cliente ao abrir o cardápio, para
 * mostrar "Solicitação já enviada" em vez de oferecer o botão de novo.
 *
 * Devolve `null` se o token não resolver (mesa desativada, restaurante fora
 * do ar): aí o cardápio já nem é servido, mas o guard evita chamada inútil.
 */
export async function readTableRequestState(
  tableToken: string,
): Promise<TableRequestState | null> {
  const parsed = tokenSchema.safeParse(tableToken);
  if (!parsed.success) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_table_request_state", {
    p_token: parsed.data,
  });

  if (error || !data) return null;

  const row = (Array.isArray(data) ? data[0] : data) as TableRequestState | undefined;
  return row ?? null;
}

/* -------------------------------------------------------------------------- */
/* Lado do restaurante                                                        */
/* -------------------------------------------------------------------------- */

const setStatusSchema = z.object({
  requestId: z.string().uuid("Solicitação inválida."),
  status: z.enum(["acknowledged", "resolved", "cancelled"]),
});

export type TableRequestActionResult =
  | { ok: true; status: TableRequestStatus }
  | { ok: false; error: string };

export async function setTableRequestStatus(
  input: unknown,
): Promise<TableRequestActionResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Restaurante não encontrado." };

  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_table_request_status", {
    p_request_id: parsed.data.requestId,
    p_status: parsed.data.status,
  });

  if (error) {
    const message = error.message?.includes("already_closed")
      ? "Essa solicitação já foi encerrada."
      : error.message?.includes("request_not_found")
        ? "Solicitação não encontrada."
        : "Não foi possível atualizar a solicitação. Tente novamente.";
    return { ok: false, error: message };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { status: TableRequestStatus }
    | undefined;

  return { ok: true, status: row?.status ?? parsed.data.status };
}

export async function fetchTableRequests(openOnly = true): Promise<TableRequest[]> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return [];
  return listTableRequests({ restaurantId: restaurant.id, openOnly, limit: 30 });
}

export async function fetchTableRequestCounts(): Promise<{
  pending: number;
  acknowledged: number;
  bills: number;
}> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { pending: 0, acknowledged: 0, bills: 0 };
  return tableRequestCounts(restaurant.id);
}
