"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/data/admin";

/**
 * Ações do painel master — Etapa 10.
 *
 * Regra de ouro deste arquivo: **a interface não autoriza nada**.
 *
 *   1. Toda ação confere `isPlatformAdmin()` antes de falar com o banco. Isso
 *      evita que um formulário escondido chegue a executar a RPC.
 *   2. Mas a autoridade real é do banco: cada RPC repete a checagem
 *      (`admin_forbidden`) e o trigger `guard_restaurant_admin_fields` fecha o
 *      caminho de quem tentar `update` direto pelo PostgREST.
 *   3. Nenhum id de autor vem do payload. O ator é sempre `auth.uid()`, lido
 *      dentro da função `log_admin_action` — do contrário daria para forjar
 *      autoria no histórico.
 *
 * As mensagens de erro são traduzidas aqui para que a tela mostre algo em
 * português e não um código do Postgres.
 */

const FORBIDDEN = "Você não tem acesso ao painel da plataforma.";

export type AdminActionResult = { ok: true; message: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function translate(message: string | undefined, fallback: string): string {
  const raw = message ?? "";
  if (raw.includes("admin_forbidden")) return FORBIDDEN;
  if (raw.includes("restaurant_suspended_locked")) {
    return "Restaurante suspenso só pode ser reativado pela plataforma.";
  }
  if (raw.includes("restaurant_plan_locked")) {
    return "Plano e assinatura são definidos pela plataforma.";
  }
  if (raw.includes("reason_required")) return "Informe o motivo da suspensão.";
  if (raw.includes("reason_too_long")) return "O motivo pode ter no máximo 280 caracteres.";
  if (raw.includes("last_owner")) {
    return "Este é o único proprietário ativo: a casa ficaria sem administrador.";
  }
  if (raw.includes("slug_unavailable")) return "Este link já está em uso por outro restaurante.";
  if (raw.includes("invalid_slug")) return "Use apenas letras minúsculas, números e hífens no link.";
  if (raw.includes("invalid_name")) return "Informe o nome do restaurante.";
  if (raw.includes("invalid_plan")) return "Plano inválido.";
  if (raw.includes("restaurant_not_found")) return "Restaurante não encontrado.";
  if (raw.includes("member_not_found")) return "Vínculo não encontrado.";
  return fallback;
}

/** Guarda comum: devolve o cliente já autenticado ou `null`. */
async function requireAdmin() {
  if (!(await isPlatformAdmin())) return null;
  return createClient();
}

/* -------------------------------------------------------------------------- */
/* Restaurante: status                                                        */
/* -------------------------------------------------------------------------- */

const statusSchema = z.object({
  restaurantId: z.string().regex(UUID),
  status: z.enum(["published", "paused", "suspended"]),
  reason: z.string().trim().max(280).optional().nullable(),
});

/**
 * Ativa, desativa ou suspende um restaurante.
 *
 * Suspender exige motivo — é o texto que o dono lê ao abrir o painel, e sem
 * ele a suspensão vira um "não funciona" sem explicação. Reativar limpa o
 * motivo no banco, então a tela não precisa lembrar de fazer isso.
 */
export async function setRestaurantStatus(input: unknown): Promise<AdminActionResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await requireAdmin();
  if (!supabase) return { ok: false, error: FORBIDDEN };

  const { restaurantId, status, reason } = parsed.data;
  if (status === "suspended" && !reason?.trim()) {
    return { ok: false, error: "Informe o motivo da suspensão." };
  }

  const { error } = await supabase.rpc("admin_set_restaurant_status", {
    p_restaurant_id: restaurantId,
    p_status: status,
    p_reason: reason?.trim() || null,
  });

  if (error) {
    return { ok: false, error: translate(error.message, "Não foi possível alterar o status.") };
  }

  // O cardápio público e o painel do dono precisam refletir a decisão agora.
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/restaurantes/${restaurantId}`);
  revalidatePath("/app", "layout");
  revalidatePath("/r", "layout");

  const message =
    status === "suspended"
      ? "Restaurante suspenso. O cardápio público saiu do ar."
      : status === "published"
        ? "Restaurante ativado."
        : "Restaurante desativado.";

  return { ok: true, message };
}

/* -------------------------------------------------------------------------- */
/* Restaurante: dados cadastrais                                              */
/* -------------------------------------------------------------------------- */

const updateSchema = z.object({
  restaurantId: z.string().regex(UUID),
  name: z.string().trim().min(2, "Informe o nome.").max(120, "Nome muito longo."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "O link precisa ter pelo menos 3 caracteres.")
    .max(48, "O link pode ter no máximo 48 caracteres.")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use apenas letras minúsculas, números e hífens."),
  phone: z.string().trim().max(32, "Telefone inválido.").optional(),
  description: z.string().trim().max(500, "Máximo de 500 caracteres.").optional(),
  planId: z.string().trim().max(32).optional(),
});

export async function updateRestaurant(input: unknown): Promise<AdminActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await requireAdmin();
  if (!supabase) return { ok: false, error: FORBIDDEN };

  const data = parsed.data;
  const { error } = await supabase.rpc("admin_update_restaurant", {
    p_restaurant_id: data.restaurantId,
    p_name: data.name,
    p_slug: data.slug,
    p_phone: data.phone || null,
    p_description: data.description || null,
    p_plan_id: data.planId || null,
  });

  if (error) {
    return { ok: false, error: translate(error.message, "Não foi possível salvar.") };
  }

  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/restaurantes/${data.restaurantId}`);
  // Slug mudou: o próprio cardápio antigo deixou de existir.
  revalidatePath(`/r/${data.slug}`, "layout");

  return { ok: true, message: "Dados atualizados." };
}

/* -------------------------------------------------------------------------- */
/* Equipe                                                                     */
/* -------------------------------------------------------------------------- */

const memberRoleSchema = z.object({
  restaurantId: z.string().regex(UUID),
  userId: z.string().regex(UUID),
  role: z.enum(["owner", "admin", "manager", "staff"]),
});

export async function setMemberRole(input: unknown): Promise<AdminActionResult> {
  const parsed = memberRoleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await requireAdmin();
  if (!supabase) return { ok: false, error: FORBIDDEN };

  const { restaurantId, userId, role } = parsed.data;
  const { error } = await supabase.rpc("admin_set_member_role", {
    p_restaurant_id: restaurantId,
    p_user_id: userId,
    p_role: role,
  });

  if (error) {
    return { ok: false, error: translate(error.message, "Não foi possível alterar o papel.") };
  }

  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/restaurantes/${restaurantId}`);
  revalidatePath(`/admin/usuarios`);

  return { ok: true, message: "Papel atualizado." };
}

const memberStatusSchema = z.object({
  restaurantId: z.string().regex(UUID),
  userId: z.string().regex(UUID),
  status: z.enum(["active", "invited", "suspended"]),
});

export async function setMemberStatus(input: unknown): Promise<AdminActionResult> {
  const parsed = memberStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await requireAdmin();
  if (!supabase) return { ok: false, error: FORBIDDEN };

  const { restaurantId, userId, status } = parsed.data;
  const { error } = await supabase.rpc("admin_set_member_status", {
    p_restaurant_id: restaurantId,
    p_user_id: userId,
    p_status: status,
  });

  if (error) {
    return { ok: false, error: translate(error.message, "Não foi possível alterar o acesso.") };
  }

  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/restaurantes/${restaurantId}`);
  revalidatePath(`/admin/usuarios`);

  return {
    ok: true,
    message: status === "active" ? "Acesso liberado." : "Acesso bloqueado.",
  };
}

/* -------------------------------------------------------------------------- */
/* Acesso de suporte                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Registra na auditoria que o admin abriu o contexto de suporte de uma casa.
 *
 * Chamado pela tela antes de sair para o cardápio público: o escopo pede
 * "acesso administrativo controlado para suporte", e controlar significa
 * deixar rastro, não esconder o botão.
 */
export async function logSupportAccess(
  restaurantId: string,
  note?: string,
): Promise<AdminActionResult> {
  if (!UUID.test(restaurantId)) return { ok: false, error: "Restaurante inválido." };

  const supabase = await requireAdmin();
  if (!supabase) return { ok: false, error: FORBIDDEN };

  const { error } = await supabase.rpc("admin_log_support_access", {
    p_restaurant_id: restaurantId,
    p_note: note?.trim() || null,
  });

  if (error) {
    return { ok: false, error: translate(error.message, "Não foi possível registrar o acesso.") };
  }

  revalidatePath("/admin/auditoria");
  return { ok: true, message: "Acesso de suporte registrado." };
}

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Vira admin da plataforma quando **ainda não existe nenhum**.
 *
 * Só funciona para o usuário mais antigo da instalação e nunca depois do
 * primeiro admin — o banco decide, não a tela. Serve para uma instalação nova
 * não depender de acesso ao SQL editor.
 */
export async function claimPlatformAdmin(): Promise<AdminActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_first_platform_admin");

  if (error) {
    return { ok: false, error: "Não foi possível verificar o acesso." };
  }
  if (data !== true) {
    return {
      ok: false,
      error: "Esta instalação já tem um administrador da plataforma.",
    };
  }

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Você agora é administrador da plataforma." };
}
