"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { MAX_HEADLINE_LENGTH, sanitizeHeadline } from "@/lib/share";

/**
 * Server Actions da divulgação — Etapa 23.
 *
 * Só uma coisa é gravável aqui: a **chamada** da mensagem. Link, QR e token não
 * passam por action — o link é derivado do slug e do token lidos do banco, e o
 * QR geral é desenhado a partir dele. Aceitar qualquer um dos três do cliente
 * abriria a porta para uma plaquinha apontando para o site de outra pessoa.
 */

export type ShareActionResult =
  | { ok: true; headline: string | null; message?: string }
  | { ok: false; error: string };

const headlineSchema = z.object({
  headline: z.string().max(2000),
});

/**
 * Salva a chamada de divulgação.
 *
 * Texto vazio some (`null`) e volta para a chamada padrão. É o comportamento que
 * o botão "Restaurar padrão" precisa: limpar tem de ser possível, e gravar
 * `""` deixaria a coluna com dois jeitos de dizer "vazio".
 */
export async function saveShareHeadline(input: unknown): Promise<ShareActionResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Restaurante não encontrado." };
  if (restaurant.role !== "owner" && restaurant.role !== "admin") {
    return { ok: false, error: "Seu perfil não pode alterar a mensagem de divulgação." };
  }

  const parsed = headlineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Não foi possível ler a mensagem." };

  const clean = sanitizeHeadline(parsed.data.headline);
  if (clean.length > MAX_HEADLINE_LENGTH) {
    return { ok: false, error: `A mensagem pode ter no máximo ${MAX_HEADLINE_LENGTH} caracteres.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_share_headline", {
    p_restaurant_id: restaurant.id,
    p_headline: clean || null,
  });

  if (error) {
    if (error.message?.includes("share_forbidden")) {
      return { ok: false, error: "Seu perfil não pode alterar a mensagem de divulgação." };
    }
    if (error.message?.includes("share_headline_too_long")) {
      return { ok: false, error: `A mensagem pode ter no máximo ${MAX_HEADLINE_LENGTH} caracteres.` };
    }
    return { ok: false, error: "Não foi possível salvar a mensagem. Tente novamente." };
  }

  const row = (Array.isArray(data) ? data[0] : data) as { share_headline?: string | null } | undefined;
  const saved = row?.share_headline ?? null;

  /*
   * Espelho em `settings.share_headline`.
   *
   * A coluna é a fonte de verdade (validada, com check de tamanho e RPC própria).
   * O espelho existe porque a **view pública** `public_restaurants` expõe
   * `settings` e não a coluna nova: acrescentar a coluna lá faria toda leitura do
   * cardápio carregar texto de divulgação e mudaria o contrato da view na mesma
   * etapa em que ela passou a alimentar a prévia do link.
   *
   * Falha aqui não invalida o salvamento: a chamada já está gravada na coluna, e
   * o cardápio cai na `description`. Por isso o erro é engolido — com uma nota
   * no log — em vez de devolver "não foi possível salvar" para algo que salvou.
   */
  await mirrorHeadlineToSettings(saved);

  // O cardápio público usa a chamada na prévia do link (OG) e o painel a usa na
  // tela de divulgação: as duas páginas precisam ser revalidadas.
  revalidatePath("/app/divulgar");
  revalidatePath("/app", "layout");

  return {
    ok: true,
    headline: saved,
    message: clean ? "Mensagem salva." : "Mensagem voltou ao padrão.",
  };
}

/**
 * Copia a chamada para `settings.share_headline`.
 *
 * Usa a mesma sessão do usuário (nada de `service_role`): a policy
 * `restaurants_update_admin` já permite que dono/admin escrevam na própria casa,
 * e um erro de policy deve falhar aqui — não ser contornado com chave de serviço.
 */
async function mirrorHeadlineToSettings(headline: string | null) {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return;

  const supabase = await createClient();

  // Lê o `settings` atual para não sobrescrever as outras preferências que
  // moram nele (horário, tema, idioma).
  const { data: current, error: readError } = await supabase
    .from("restaurants")
    .select("settings")
    .eq("id", restaurant.id)
    .maybeSingle();

  if (readError) return;

  const settings =
    current?.settings && typeof current.settings === "object" && !Array.isArray(current.settings)
      ? { ...(current.settings as Record<string, unknown>) }
      : {};

  if (headline) settings.share_headline = headline;
  else delete settings.share_headline;

  await supabase.from("restaurants").update({ settings }).eq("id", restaurant.id);

  // A página pública é ISR: sem revalidar, a prévia do link continuaria com o
  // texto antigo por até um minuto. Não é erro se falhar (a próxima visita
  // revalida sozinha), por isso o retorno é ignorado.
  revalidatePath(`/r/${restaurant.slug}`);
}
