"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getRestaurantTheme } from "@/lib/data/theme";
import { normalizeTheme } from "@/lib/theme";
import type { RestaurantTheme } from "@/lib/types";

/**
 * Ações do tema do cardápio — Etapa 9.
 *
 * Regras que este arquivo garante:
 *
 *  1. **O restaurante vem do servidor**, nunca do corpo da requisição. Mesmo
 *     que o navegador mande outro `restaurantId`, ele é ignorado — quem manda é
 *     o vínculo ativo de `getActiveRestaurant`.
 *  2. **Validação em duas camadas**: Zod aqui (mensagem boa para a tela) e
 *     `save_restaurant_theme` no banco (recusa hex inválido, estilo fora da
 *     lista e imagem de outro tenant).
 *  3. **Revalidação do cardápio público** depois de salvar: `/r/{slug}` tem
 *     `revalidate = 60`, e sem isso o cliente veria o tema antigo por até um
 *     minuto depois de publicar.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

const hex = z
  .string()
  .trim()
  .regex(HEX, "Use uma cor no formato #RRGGBB.")
  .transform((value) => value.toLowerCase());

const themeSchema = z.object({
  preset: z
    .enum(["moderno", "elegante", "dark", "minimalista", "restaurante", "fastfood"])
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  primaryColor: hex,
  secondaryColor: hex,
  backgroundColor: hex,
  textColor: hex,
  buttonColor: hex,
  cardStyle: z.enum(["rounded", "soft", "flat"]),
  buttonStyle: z.enum(["solid", "outline", "pill"]),
  logoUrl: z.string().trim().nullable().optional(),
  coverUrl: z.string().trim().nullable().optional(),
});

export type SaveThemeResult =
  | { ok: true; theme: RestaurantTheme; message: string }
  | { ok: false; error: string };

/** Traduz o erro da RPC para algo que o dono do restaurante entenda. */
/**
 * Recurso do plano (Etapa 11).
 *
 * A personalização visual é `custom_theme`: no plano Grátis ela não existe. A
 * checagem roda aqui **antes** da RPC e de novo no banco (`save_restaurant_theme`
 * valida o vínculo), porque esconder o botão nunca foi autorização.
 */
async function requireThemeFeature(restaurantId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_feature", {
    p_restaurant_id: restaurantId,
    p_feature: "custom_theme",
  });

  if (error) return null;
  return data === true;
}

function translateError(message: string | undefined): string {
  if (message?.includes("theme_forbidden")) {
    return "Você não tem permissão para personalizar este cardápio.";
  }
  if (message?.includes("invalid_color")) {
    return "Uma das cores não é válida. Confira os campos destacados.";
  }
  if (message?.includes("invalid_image_url")) {
    return "A imagem enviada não pertence a este restaurante. Envie novamente.";
  }
  if (message?.includes("invalid_card_style") || message?.includes("invalid_button_style")) {
    return "Escolha um dos estilos disponíveis.";
  }
  return "Não foi possível salvar o tema. Tente novamente.";
}

export async function saveTheme(input: unknown): Promise<SaveThemeResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) {
    return { ok: false, error: "Restaurante não encontrado." };
  }

  // Recurso do plano (Etapa 11): `custom_theme` não existe no Grátis. Recusar
  // aqui dá a mensagem certa antes do trabalho de gravar; a RPC continua
  // guardando o vínculo, então a feature é conferência, não autorização.
  if (!(await requireThemeFeature(restaurant.id))) {
    return {
      ok: false,
      error: "Seu plano não inclui personalização visual. Veja os planos para liberar este recurso.",
    };
  }

  const parsed = themeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Confira as cores e tente novamente.",
    };
  }

  const data = parsed.data;
  const supabase = await createClient();

  const { data: saved, error } = await supabase.rpc("save_restaurant_theme", {
    // Do servidor, não do payload.
    p_restaurant_id: restaurant.id,
    p_preset: data.preset,
    p_primary_color: data.primaryColor,
    p_secondary_color: data.secondaryColor,
    p_background_color: data.backgroundColor,
    p_text_color: data.textColor,
    p_button_color: data.buttonColor,
    p_card_style: data.cardStyle,
    p_button_style: data.buttonStyle,
    p_logo_url: data.logoUrl || null,
    p_cover_url: data.coverUrl || null,
  });

  if (error) {
    return { ok: false, error: translateError(error.message) };
  }

  const row = (Array.isArray(saved) ? saved[0] : saved) as Record<string, unknown> | undefined;

  // O cardápio público é servido com revalidate: sem estes dois, o cliente
  // veria a identidade antiga por até um minuto.
  revalidatePath(`/r/${restaurant.slug}`, "layout");
  revalidatePath("/app/configuracoes/personalizacao");
  revalidatePath("/app");

  return {
    ok: true,
    theme: normalizeTheme(row ?? data),
    message: "Cardápio personalizado.",
  };
}

export type ResetThemeResult = { ok: true; message: string } | { ok: false; error: string };

/** Volta ao tema padrão (apaga a linha; o fallback assume). */
export async function resetTheme(): Promise<ResetThemeResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Restaurante não encontrado." };

  if (!(await requireThemeFeature(restaurant.id))) {
    return {
      ok: false,
      error: "Seu plano não inclui personalização visual. Veja os planos para liberar este recurso.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("reset_restaurant_theme", {
    p_restaurant_id: restaurant.id,
  });

  if (error) {
    return {
      ok: false,
      error: error.message?.includes("theme_forbidden")
        ? "Você não tem permissão para personalizar este cardápio."
        : "Não foi possível restaurar o tema padrão.",
    };
  }

  revalidatePath(`/r/${restaurant.slug}`, "layout");
  revalidatePath("/app/configuracoes/personalizacao");

  return { ok: true, message: "Tema padrão restaurado." };
}

/** Tema atual, para o editor abrir já preenchido. */
export async function readTheme(): Promise<RestaurantTheme | null> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return null;
  return getRestaurantTheme(restaurant.id);
}

/* -------------------------------------------------------------------------- */
/* Upload de imagem                                                           */
/* -------------------------------------------------------------------------- */

/**
 * O upload é feito **no navegador, direto para o Storage** (veja
 * `theme-upload.ts`): o arquivo nunca passa por uma Server Action, então uma
 * capa de 5 MB não vira payload de função e o progresso é real.
 *
 * O que mora aqui é a parte que não pode ser confiada ao cliente: autorizar o
 * caminho e devolver a URL pública do tenant certo.
 */
export type UploadTarget = {
  ok: true;
  path: string;
  publicUrl: string;
  /** Cache-buster: o mesmo nome de arquivo é sobrescrito a cada troca. */
  version: string;
};

/**
 * Gera o caminho de upload do tenant ativo.
 *
 * `{restaurant_id}/theme/{logo|cover}-{timestamp}.{ext}` — o primeiro segmento
 * é o que a policy do Storage valida (`is_restaurant_admin` do folder), então
 * um restaurante não consegue escrever na pasta de outro nem forjando o nome.
 */
export async function createUploadTarget(
  kind: "logo" | "cover",
  extension: "png" | "jpg" | "webp",
): Promise<UploadTarget | { ok: false; error: string }> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Restaurante não encontrado." };

  // Upload de imagem NÃO exige `custom_theme`: a logo do cardápio padrão é
  // usada por todos os planos. Quem exige a feature é salvar o tema.
  if (kind !== "logo" && kind !== "cover") {
    return { ok: false, error: "Tipo de imagem inválido." };
  }
  if (!["png", "jpg", "webp"].includes(extension)) {
    return { ok: false, error: "Formato não suportado. Use PNG, JPG ou WEBP." };
  }

  const version = Date.now().toString(36);
  const path = `${restaurant.id}/theme/${kind}-${version}.${extension}`;

  const supabase = await createClient();
  const { data } = supabase.storage.from("restaurant-assets").getPublicUrl(path);

  return { ok: true, path, publicUrl: data.publicUrl, version };
}
