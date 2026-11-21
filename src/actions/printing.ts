"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getPrintConfig, getPrintOrder } from "@/lib/data/printing";
import {
  FOOTER_NOTE_MAX,
  PRINTER_IDENTIFIER_MAX,
  PRINTER_NAME_MAX,
  PROFILE_NAME_MAX,
  normalizeCopies,
} from "@/lib/printing";
import type { PrintConfig, PrintOrderDocument } from "@/lib/types";

/**
 * Ações de impressão — Etapa 18.
 *
 * Três garantias que este arquivo dá:
 *
 *   1. **O restaurante vem do servidor.** Nenhuma ação aceita `restaurantId` do
 *      navegador: quem manda é o vínculo ativo. Um id copiado de outra casa não
 *      serve para nada aqui.
 *   2. **Validação em duas camadas.** Zod para mensagem boa na tela; RPC para
 *      recusar quem não é admin. Zod sozinho nunca foi autorização.
 *   3. **Nada de "imprimiu".** O registro da solicitação (`log_print_job`) é
 *      feito com o status que o provedor consegue afirmar — hoje `requested`.
 */

const paperWidth = z.enum(["58", "80"]);
const providerKind = z.enum(["browser", "os", "web_print", "bridge", "service"]);
const jobStatus = z.enum(["requested", "printed", "failed", "unsupported"]);

export type PrintActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { message?: string } : { data: T; message?: string }))
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Traduz o erro da RPC para algo que o dono do restaurante entenda. */
function translate(message: string | undefined): string {
  const text = message ?? "";
  if (text.includes("print_forbidden")) {
    return "Você não tem permissão para configurar a impressão desta casa.";
  }
  if (text.includes("order_not_found")) {
    return "Pedido não encontrado.";
  }
  if (text.includes("profile_not_found")) {
    return "Perfil de impressão não encontrado.";
  }
  if (text.includes("printer_not_found")) {
    return "Impressora não encontrada.";
  }
  if (text.includes("invalid_profile_name")) {
    return "Dê um nome ao perfil de impressão.";
  }
  if (text.includes("invalid_printer_name")) {
    return "Dê um nome à impressora.";
  }
  return "Não foi possível salvar a impressão. Tente novamente.";
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }
  return fieldErrors;
}

/* -------------------------------------------------------------------------- */
/* Configuração                                                               */
/* -------------------------------------------------------------------------- */

const settingsSchema = z.object({
  mode: z.enum(["manual", "auto"]),
  default_paper_width: paperWidth,
  print_orders: z.boolean(),
  print_tickets: z.boolean(),
  print_kitchen: z.boolean(),
  print_counter: z.boolean(),
  copies: z.coerce.number().int().min(1).max(3),
  footer_note: z.string().trim().max(FOOTER_NOTE_MAX).optional().default(""),
});

export async function savePrintSettings(
  input: unknown,
): Promise<PrintActionResult<PrintConfig>> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };

  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  const data = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_print_settings", {
    p_restaurant_id: restaurant.id,
    p_mode: data.mode,
    p_default_paper_width: data.default_paper_width,
    p_print_orders: data.print_orders,
    p_print_tickets: data.print_tickets,
    p_print_kitchen: data.print_kitchen,
    p_print_counter: data.print_counter,
    p_copies: normalizeCopies(data.copies),
    p_footer_note: data.footer_note ?? "",
  });

  if (error) return { ok: false, error: translate(error.message) };

  revalidatePath("/app/configuracoes/impressao");
  revalidatePath("/app/configuracoes");

  return {
    ok: true,
    data: await getPrintConfig(restaurant.id),
    message: data.mode === "auto" ? "Impressão automática ativada." : "Impressão manual configurada.",
  };
}

/* -------------------------------------------------------------------------- */
/* Perfis                                                                     */
/* -------------------------------------------------------------------------- */

const profileSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, "Dê um nome ao perfil.").max(PROFILE_NAME_MAX),
  kind: z.enum(["kitchen", "counter", "bar", "cashier"]),
  paper_width: paperWidth,
  copies: z.coerce.number().int().min(1).max(3),
  is_active: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(999).optional().default(0),
});

export async function savePrintProfile(
  input: unknown,
): Promise<PrintActionResult<PrintConfig>> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  const data = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_print_profile", {
    p_restaurant_id: restaurant.id,
    p_profile_id: data.id ?? null,
    p_name: data.name,
    p_kind: data.kind,
    p_paper_width: data.paper_width,
    p_copies: normalizeCopies(data.copies),
    p_is_active: data.is_active,
    p_sort_order: data.sort_order ?? 0,
  });

  if (error) return { ok: false, error: translate(error.message) };

  revalidatePath("/app/configuracoes/impressao");

  return {
    ok: true,
    data: await getPrintConfig(restaurant.id),
    message: data.id ? "Perfil atualizado." : "Perfil criado.",
  };
}

export async function deletePrintProfile(
  profileId: string,
): Promise<PrintActionResult<PrintConfig>> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };

  if (!z.string().uuid().safeParse(profileId).success) {
    return { ok: false, error: "Perfil inválido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_print_profile", {
    p_restaurant_id: restaurant.id,
    p_profile_id: profileId,
  });

  if (error) return { ok: false, error: translate(error.message) };

  revalidatePath("/app/configuracoes/impressao");
  return {
    ok: true,
    data: await getPrintConfig(restaurant.id),
    message: "Perfil removido.",
  };
}

/** Cria COZINHA, BALCÃO, BAR e CAIXA em um toque. Idempotente por slug. */
export async function seedPrintProfiles(): Promise<PrintActionResult<PrintConfig>> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seed_default_print_profiles", {
    p_restaurant_id: restaurant.id,
  });

  if (error) return { ok: false, error: translate(error.message) };

  revalidatePath("/app/configuracoes/impressao");

  const created = Number(data ?? 0);
  return {
    ok: true,
    data: await getPrintConfig(restaurant.id),
    message:
      created > 0
        ? `${created} ${created === 1 ? "perfil criado" : "perfis criados"}.`
        : "Os quatro perfis já existiam.",
  };
}

/* -------------------------------------------------------------------------- */
/* Impressoras                                                                */
/* -------------------------------------------------------------------------- */

const printerSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  profile_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, "Dê um nome à impressora.").max(PRINTER_NAME_MAX),
  provider: providerKind,
  identifier: z.string().trim().max(PRINTER_IDENTIFIER_MAX).optional().default(""),
  paper_width: paperWidth,
  is_default: z.boolean(),
  is_active: z.boolean(),
  notes: z.string().trim().max(200).optional().default(""),
});

export async function savePrinter(
  input: unknown,
): Promise<PrintActionResult<PrintConfig>> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };

  const parsed = printerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  const data = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_printer", {
    p_restaurant_id: restaurant.id,
    p_printer_id: data.id ?? null,
    p_profile_id: data.profile_id ?? null,
    p_name: data.name,
    p_provider: data.provider,
    p_identifier: data.identifier ?? "",
    p_paper_width: data.paper_width,
    p_is_default: data.is_default,
    p_is_active: data.is_active,
    p_notes: data.notes ?? "",
  });

  if (error) return { ok: false, error: translate(error.message) };

  revalidatePath("/app/configuracoes/impressao");

  return {
    ok: true,
    data: await getPrintConfig(restaurant.id),
    message: data.id ? "Impressora atualizada." : "Impressora adicionada.",
  };
}

export async function deletePrinter(
  printerId: string,
): Promise<PrintActionResult<PrintConfig>> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };

  if (!z.string().uuid().safeParse(printerId).success) {
    return { ok: false, error: "Impressora inválida." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_printer", {
    p_restaurant_id: restaurant.id,
    p_printer_id: printerId,
  });

  if (error) return { ok: false, error: translate(error.message) };

  revalidatePath("/app/configuracoes/impressao");
  return {
    ok: true,
    data: await getPrintConfig(restaurant.id),
    message: "Impressora removida.",
  };
}

/* -------------------------------------------------------------------------- */
/* Leitura para a tela de impressão                                           */
/* -------------------------------------------------------------------------- */

/**
 * Documento do pedido para `/app/pedidos/[id]/imprimir`.
 *
 * Fica em `actions` (e não em `data`) porque é chamado pelo cliente ao abrir a
 * tela a partir do painel — mas continua sem confiar em nada do navegador: o
 * `orderId` é só uma chave, e a RPC confere o vínculo.
 */
export async function fetchPrintOrder(
  orderId: string,
): Promise<{ ok: true; data: PrintOrderDocument } | { ok: false; error: string }> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };

  if (!z.string().uuid().safeParse(orderId).success) {
    return { ok: false, error: "Pedido inválido." };
  }

  const document = await getPrintOrder(orderId);
  if (!document) return { ok: false, error: "Pedido não encontrado." };

  // Cinto e suspensório: a RPC já limita, mas documento de outra casa nunca
  // deve chegar a esta tela.
  if (document.restaurant.id !== restaurant.id) {
    return { ok: false, error: "Pedido não encontrado." };
  }

  return { ok: true, data: document };
}

/* -------------------------------------------------------------------------- */
/* Registro da solicitação                                                    */
/* -------------------------------------------------------------------------- */

const jobSchema = z.object({
  orderId: z.string().uuid(),
  profileId: z.string().uuid().nullable().optional(),
  printerId: z.string().uuid().nullable().optional(),
  provider: providerKind,
  paperWidth: paperWidth,
  copies: z.coerce.number().int().min(1).max(3),
  status: jobStatus,
  detail: z.string().trim().max(200).optional().default(""),
});

/**
 * Registra que a impressão foi **pedida**.
 *
 * A tela chama isto antes de abrir a janela de impressão; o status que ela
 * manda é o que o provedor sabe afirmar (`requested` no navegador). Se o
 * registro falhar, a impressão não é bloqueada: perder o log é chato, perder o
 * cupom no meio do serviço é pior.
 */
export async function logPrintJob(input: unknown): Promise<{ ok: boolean }> {
  const parsed = jobSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const data = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_print_job", {
    p_order_id: data.orderId,
    p_profile_id: data.profileId ?? null,
    p_printer_id: data.printerId ?? null,
    p_provider: data.provider,
    p_paper_width: data.paperWidth,
    p_copies: data.copies,
    p_status: data.status,
    p_detail: data.detail ?? "",
  });

  return { ok: !error };
}
