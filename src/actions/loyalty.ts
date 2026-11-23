"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { readCustomerPoints } from "@/lib/data/loyalty";
import {
  MAX_ADJUST_NOTE,
  MAX_PROGRAM_NOTE,
  cleanName,
  isValidEmail,
  isValidPhone,
  normalizePhone,
} from "@/lib/loyalty";

/**
 * Server Actions de clientes e fidelidade — Etapa 24.
 *
 * ─── A regra desta camada ─────────────────────────────────────────────────
 *
 * Nenhuma action recebe `restaurantId` do cliente. O restaurante vem de
 * `getActiveRestaurant()` (sessão + vínculo), e o id do cliente é validado
 * contra ele pela RPC. Se alguém forjar um `customerId` de outra casa, a RPC
 * devolve `customer_not_found` — a action não tem como saber que o cliente
 * existe, e é assim que deve ser.
 *
 * ─── O que não é action ───────────────────────────────────────────────────
 *
 * Criar cliente **não** é action. Só existe pelo caminho do pedido
 * (`create_order` → `upsert_customer_for_order`), onde o restaurante vem do
 * token da mesa e o consentimento é obrigatório. Uma action "criar cliente"
 * aceitaria nome e telefone de qualquer um, sem pedido e sem aceite — seria a
 * porta dos fundos da LGPD.
 */

export type LoyaltyActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Traduz erro da RPC para a frase da tela. */
function translate(message: string | undefined): string {
  const text = message ?? "";
  if (text.includes("loyalty_forbidden")) return "Seu perfil não pode alterar isso.";
  if (text.includes("customer_not_found")) return "Cliente não encontrado.";
  if (text.includes("customer_erased")) return "Este cliente pediu a exclusão dos dados.";
  if (text.includes("invalid_phone")) return "Informe um WhatsApp válido com DDD.";
  if (text.includes("invalid_email")) return "Informe um e-mail válido.";
  if (text.includes("customer_name_too_long")) return "O nome ficou longo demais.";
  if (text.includes("insufficient_points")) return "O saldo do cliente não cobre esse ajuste.";
  if (text.includes("birthday_bonus_disabled")) return "Configure o bônus de aniversário antes de creditar.";
  if (text.includes("loyalty_note_too_long")) return "A observação ficou longa demais.";
  if (text.includes("invalid_points")) return "Informe uma quantidade de pontos diferente de zero.";
  return "Não foi possível salvar. Tente novamente.";
}

const uuid = z.string().uuid("Registro não identificado.");

const settingsSchema = z.object({
  enabled: z.boolean(),
  points_per_currency: z.number().min(0).max(100),
  signup_bonus: z.number().int().min(0).max(100_000),
  birthday_bonus: z.number().int().min(0).max(100_000),
  redeem_value: z.number().min(0).max(1000),
  program_note: z.string().max(2000).nullable().optional(),
});

/**
 * Grava a regra de pontos.
 *
 * A validação de faixa acontece **aqui e no banco**: aqui para dar mensagem por
 * campo, no banco porque `save_loyalty_settings` é chamável direto pelo
 * PostgREST com a anon key.
 */
export async function saveLoyaltySettings(input: unknown): Promise<LoyaltyActionResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Restaurante não encontrado." };

  if (restaurant.role !== "owner" && restaurant.role !== "admin") {
    return { ok: false, error: "Seu perfil não pode alterar o programa de fidelidade." };
  }

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Revise os valores do programa." };
  }

  const note = parsed.data.program_note?.trim() ?? "";
  if (note.length > MAX_PROGRAM_NOTE) {
    return {
      ok: false,
      error: `A mensagem pode ter no máximo ${MAX_PROGRAM_NOTE} caracteres.`,
      fieldErrors: { programNote: `Máximo de ${MAX_PROGRAM_NOTE} caracteres.` },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_loyalty_settings", {
    p_restaurant_id: restaurant.id,
    p_enabled: parsed.data.enabled,
    p_points_per_currency: parsed.data.points_per_currency,
    p_signup_bonus: parsed.data.signup_bonus,
    p_birthday_bonus: parsed.data.birthday_bonus,
    p_redeem_value: parsed.data.redeem_value,
    p_program_note: note || null,
  });

  if (error) return { ok: false, error: translate(error.message) };

  revalidatePath("/app/clientes");
  revalidatePath("/app/clientes/fidelidade");
  // O cardápio público mostra o texto do programa e o saldo do cliente.
  revalidatePath("/app", "layout");

  return {
    ok: true,
    message: parsed.data.enabled ? "Programa de fidelidade salvo." : "Programa desativado.",
  };
}

const updateSchema = z.object({
  customerId: uuid,
  name: z.string().max(200).optional().default(""),
  email: z.string().max(200).optional().default(""),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
    .optional()
    .or(z.literal(""))
    .optional(),
});

/**
 * Atualiza nome, e-mail e data de nascimento.
 *
 * A data de nascimento não vem do cliente final: é o dono que preenche, para
 * saber a quem dar o bônus de aniversário. Coletar isso no cardápio seria dado
 * pessoal a mais sem contrapartida nenhuma para o cliente.
 */
export async function updateCustomer(input: unknown): Promise<LoyaltyActionResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Restaurante não encontrado." };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Não foi possível ler os dados." };

  const name = cleanName(parsed.data.name);
  const email = parsed.data.email.trim().toLowerCase();

  if (email && !isValidEmail(email)) {
    return { ok: false, error: "Informe um e-mail válido.", fieldErrors: { email: "E-mail inválido." } };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_customer", {
    p_restaurant_id: restaurant.id,
    p_customer_id: parsed.data.customerId,
    p_name: name,
    p_email: email || null,
    p_birth_date: parsed.data.birthDate || null,
  });

  if (error) return { ok: false, error: translate(error.message) };

  revalidatePath("/app/clientes");
  revalidatePath(`/app/clientes/${parsed.data.customerId}`);
  return { ok: true, message: "Dados do cliente atualizados." };
}

const adjustSchema = z.object({
  customerId: uuid,
  delta: z.number().int().min(-100_000).max(100_000),
  note: z.string().max(500).optional().default(""),
});

/** Ajuste manual de pontos (cortesia, correção de pedido atrasado). */
export async function adjustCustomerPoints(input: unknown): Promise<LoyaltyActionResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Restaurante não encontrado." };

  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Informe uma quantidade de pontos." };

  if (parsed.data.delta === 0) {
    return { ok: false, error: "Informe uma quantidade de pontos diferente de zero." };
  }

  const note = parsed.data.note.trim();
  if (note.length > MAX_ADJUST_NOTE) {
    return { ok: false, error: `A observação pode ter no máximo ${MAX_ADJUST_NOTE} caracteres.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adjust_customer_points", {
    p_restaurant_id: restaurant.id,
    p_customer_id: parsed.data.customerId,
    p_delta: parsed.data.delta,
    p_note: note || null,
  });

  if (error) return { ok: false, error: translate(error.message) };

  revalidatePath("/app/clientes");
  revalidatePath(`/app/clientes/${parsed.data.customerId}`);

  const balance = typeof data === "number" ? data : null;
  return {
    ok: true,
    message:
      balance === null
        ? "Pontos ajustados."
        : `Pontos ajustados. Novo saldo: ${balance.toLocaleString("pt-BR")}.`,
  };
}

/** Credita o bônus de aniversário do ano corrente (uma vez por ano). */
export async function awardBirthdayBonus(customerId: string): Promise<LoyaltyActionResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Restaurante não encontrado." };

  const parsed = uuid.safeParse(customerId);
  if (!parsed.success) return { ok: false, error: "Cliente não identificado." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("award_birthday_bonus", {
    p_restaurant_id: restaurant.id,
    p_customer_id: parsed.data,
  });

  if (error) return { ok: false, error: translate(error.message) };

  revalidatePath("/app/clientes");
  revalidatePath(`/app/clientes/${parsed.data}`);

  const points = typeof data === "number" ? data : 0;
  return { ok: true, message: `Bônus de aniversário creditado (${points} pontos).` };
}

/**
 * Exclusão de dados do cliente (LGPD).
 *
 * Não apaga a linha: apaga o que identifica a pessoa. O histórico de pedidos da
 * casa continua fechando, e o mesmo telefone que aparecer de novo vira um
 * cadastro novo — a exclusão é para valer, não um "esconde e mostra depois".
 */
export async function eraseCustomer(customerId: string): Promise<LoyaltyActionResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Restaurante não encontrado." };

  if (restaurant.role !== "owner" && restaurant.role !== "admin") {
    return { ok: false, error: "Seu perfil não pode excluir dados de cliente." };
  }

  const parsed = uuid.safeParse(customerId);
  if (!parsed.success) return { ok: false, error: "Cliente não identificado." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("erase_customer", {
    p_restaurant_id: restaurant.id,
    p_customer_id: parsed.data,
  });

  if (error) return { ok: false, error: translate(error.message) };

  revalidatePath("/app/clientes");
  revalidatePath(`/app/clientes/${parsed.data}`);

  return data === true
    ? { ok: true, message: "Dados pessoais excluídos. O histórico de pedidos foi mantido sem identificação." }
    : { ok: true, message: "Os dados deste cliente já haviam sido excluídos." };
}

/* -------------------------------------------------------------------------- */
/* Consulta pública do cliente                                               */
/* -------------------------------------------------------------------------- */

export type MyPointsResult =
  | { ok: true; points: { name: string | null; balance: number; programNote: string | null } }
  | { ok: false; error: string };

const myPointsSchema = z.object({
  tableToken: z.string().trim().regex(/^[2-9A-HJKMNP-Z]{10,64}$/i, "Mesa não identificada."),
  phone: z.string().trim().min(8, "Informe seu WhatsApp com DDD.").max(40),
});

/**
 * Saldo do próprio cliente, pelo token da mesa + WhatsApp.
 *
 * Não é login e não finge ser: conhecer a mesa e o telefone é a mesma prova que
 * a Etapa 6 já pedia para reler um pedido. O retorno é só nome, saldo e o texto
 * do programa — nunca o extrato, nunca o telefone.
 */
export async function readMyPoints(input: unknown): Promise<MyPointsResult> {
  const parsed = myPointsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados incompletos." };
  }

  if (!isValidPhone(parsed.data.phone)) {
    return { ok: false, error: "Informe um WhatsApp válido com DDD." };
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return { ok: false, error: "Informe um WhatsApp válido com DDD." };

  const points = await readCustomerPoints(parsed.data.tableToken.toUpperCase(), phone);
  if (!points) {
    return {
      ok: false,
      error: "Não encontramos um cadastro com esse WhatsApp nesta mesa. Fale com um atendente.",
    };
  }

  return {
    ok: true,
    points: { name: points.name, balance: points.balance, programNote: points.program_note },
  };
}
