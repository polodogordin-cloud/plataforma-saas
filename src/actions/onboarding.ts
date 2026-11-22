"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { restaurantSchema } from "@/lib/validation";
import { z } from "zod";
import { getOnboardingSnapshot } from "@/lib/data/onboarding";
import {
  STEP_IDS,
  canFinish,
  readProgress,
  suggestedCategories,
  parseSegment,
  type OnboardingStepId,
  type ProgressSteps,
  type RestaurantSegment,
} from "@/lib/onboarding";

/**
 * Server Actions do onboarding — Etapa 21.
 *
 * ─── Regra que vale para o arquivo inteiro ─────────────────────────────────
 *
 * **O `restaurant_id` nunca vem do cliente.** Toda action resolve a casa com
 * `getActiveRestaurant()`, que lê a sessão no servidor. A RPC do banco também
 * confere (`is_restaurant_owner`), então há duas camadas independentes: um
 * payload adulterado encontra 42501, não uma escrita no vizinho.
 *
 * ─── Por que o cliente envia o mapa inteiro de etapas ─────────────────────
 *
 * O wizard salva ao trocar de passo. Enviar só "esta etapa mudou" exigiria
 * saber o estado do servidor e resolver conflito entre duas abas abertas.
 * Enviar o mapa completo e gravar por cima é determinístico: vale o último
 * clique, que é o que o dono acabou de ver na tela. O banco valida o
 * vocabulário antes de gravar.
 */

export type SaveResult = { ok: true; message?: string } | { ok: false; error: string };

function revalidateOnboarding() {
  revalidatePath("/app", "layout");
  revalidatePath("/app/onboarding");
  revalidatePath("/onboarding");
}

/** Sanitiza o mapa recebido: chaves e valores do vocabulário fechado. */
function sanitizeSteps(input: unknown): ProgressSteps {
  if (!input || typeof input !== "object") return {};
  const result: ProgressSteps = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!STEP_IDS.includes(key as OnboardingStepId)) continue;
    if (value !== "done" && value !== "skipped" && value !== "pending") continue;
    result[key as OnboardingStepId] = value;
  }
  return result;
}

/**
 * Salva o progresso do wizard.
 *
 * `complete` marca a conclusão. O banco recusa (`onboarding_incomplete`) quando
 * falta etapa obrigatória — a checagem aqui em TypeScript é só para dar a
 * mensagem certa antes do round-trip; quem manda é o banco.
 */
export async function saveOnboardingProgress(
  steps: ProgressSteps,
  complete = false,
): Promise<SaveResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };

  const clean = sanitizeSteps(steps);

  if (complete && !canFinish(clean)) {
    return {
      ok: false,
      error: "Complete as informações do restaurante antes de finalizar.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_onboarding_progress", {
    p_restaurant_id: restaurant.id,
    p_steps: clean,
    p_complete: complete,
  });

  if (error) {
    // Mensagem fixa: `error.message` daqui cita função e schema, e a tela é do
    // dono do restaurante, não de quem instalou o banco (Etapa 20).
    return { ok: false, error: "Não foi possível salvar o progresso. Tente novamente." };
  }

  revalidateOnboarding();
  return { ok: true, message: complete ? "Configuração concluída." : "Progresso salvo." };
}

/**
 * Grava o segmento. Separado do progresso porque é dado de negócio.
 *
 * Recusa valor fora do enum com mensagem clara — `parseSegment` normaliza
 * "Açaí", "acai" e "ACAI" para o mesmo id.
 */
export async function saveSegment(segment: string): Promise<SaveResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };

  const parsed = parseSegment(segment);
  if (!parsed) return { ok: false, error: "Escolha um segmento da lista." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_restaurant_segment", {
    p_restaurant_id: restaurant.id,
    p_segment: parsed,
  });

  if (error) {
    return { ok: false, error: "Não foi possível salvar o segmento. Tente novamente." };
  }

  revalidateOnboarding();
  return { ok: true, message: "Segmento salvo." };
}

export type ApplyCategoriesResult =
  | { ok: true; created: number; skipped: number; message: string }
  | { ok: false; error: string };

/**
 * Cria as categorias do modelo sugerido.
 *
 * A lista vem do **servidor** a partir do segmento salvo no banco — o cliente
 * não escolhe o que criar. Isso mantém a sugestão sendo uma decisão do produto:
 * mudar `SEGMENT_CATEGORIES` no código muda a sugestão para todos, sem migration
 * e sem depender de qual versão do app está aberta no celular do dono.
 *
 * Idempotente: rodar duas vezes não duplica (a RPC compara por `name_key`).
 */
export async function applySuggestedCategories(
  segment?: RestaurantSegment | null,
): Promise<ApplyCategoriesResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };

  const effective = parseSegment(segment) ?? (await currentSegment(restaurant.id));
  const names = suggestedCategories(effective);

  if (names.length === 0) {
    return {
      ok: false,
      error: "Não há modelo sugerido para este segmento. Crie suas categorias do zero.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_suggested_categories", {
    p_restaurant_id: restaurant.id,
    p_names: names,
  });

  if (error) {
    return { ok: false, error: "Não foi possível criar as categorias sugeridas." };
  }

  const result = (Array.isArray(data) ? data[0] : data) as
    | { created?: number; skipped?: number }
    | undefined;
  const created = result?.created ?? 0;
  const skipped = result?.skipped ?? 0;

  revalidateOnboarding();
  revalidatePath("/app/cardapio");
  revalidatePath("/app/cardapio/produtos");

  return {
    ok: true,
    created,
    skipped,
    message:
      created === 0
        ? "Essas categorias já existiam no seu cardápio."
        : `${created} ${created === 1 ? "categoria criada" : "categorias criadas"}${
            skipped > 0 ? ` · ${skipped} já existia${skipped === 1 ? "" : "m"}` : ""
          }.`,
  };
}

/** Segmento já salvo, sem passar pela action (leitura barata com cache). */
async function currentSegment(restaurantId: string): Promise<RestaurantSegment | null> {
  const snapshot = await getOnboardingSnapshot(restaurantId);
  return snapshot?.segment ?? null;
}

/**
 * Marca a etapa de informações como concluída depois de o dono completar
 * nome/descrição/logo ou escolher tema.
 *
 * Usada pelas telas de configuração existentes (restaurante/personalização)
 * para o wizard refletir o que já foi feito fora dele. Não valida nada: o dado
 * já foi gravado pela action de origem; aqui só se anota o progresso.
 */
export async function markStepDone(step: OnboardingStepId): Promise<SaveResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };
  if (!STEP_IDS.includes(step)) return { ok: false, error: "Etapa inválida." };

  const snapshot = await getOnboardingSnapshot(restaurant.id);
  if (!snapshot) return { ok: false, error: "Restaurante não encontrado." };

  const steps: ProgressSteps = { ...snapshot.steps, [step]: "done" };
  return saveOnboardingProgress(steps, false);
}

/**
 * Conclui o wizard e devolve o que a tela final precisa.
 *
 * O retorno traz `slug` e o id da primeira mesa ativa: a tela final mostra link
 * público e QR Code, e buscar isso de novo no cliente seria um segundo
 * round-trip numa tela que o dono vê uma vez.
 */
export type FinishResult =
  | {
      ok: true;
      slug: string;
      tableId: string | null;
      tableName: string | null;
      canView: boolean;
    }
  | { ok: false; error: string };

export async function finishOnboarding(): Promise<FinishResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };

  const snapshot = await getOnboardingSnapshot(restaurant.id);
  if (!snapshot) return { ok: false, error: "Restaurante não encontrado." };

  if (!canFinish(snapshot.steps)) {
    return { ok: false, error: "Complete as informações do restaurante antes de finalizar." };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("save_onboarding_progress", {
    p_restaurant_id: restaurant.id,
    p_steps: snapshot.steps,
    p_complete: true,
  });

  if (error) {
    return { ok: false, error: "Não foi possível concluir a configuração." };
  }

  // A mesa ativa mais antiga é a que o dono acabou de criar; é ela que a tela
  // final usa para mostrar o QR de exemplo.
  const { data: tables } = await supabase
    .from("tables")
    .select("id, name")
    .eq("restaurant_id", restaurant.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1);

  const table = (tables?.[0] ?? null) as { id: string; name: string } | null;

  revalidateOnboarding();
  revalidatePath("/app/mesas");

  return {
    ok: true,
    slug: restaurant.slug,
    tableId: table?.id ?? null,
    tableName: table?.name ?? null,
    // O link público só abre com o cardápio publicado. A tela final mostra o
    // link e um botão para publicar quando ainda está em rascunho — em vez de
    // mandar o dono para um 404.
    canView: restaurant.status === "published",
  };
}

/**
 * Esquece o progresso do wizard, mantendo tudo que foi criado.
 *
 * Serve para "rever o passo a passo" em Ajustes. Não apaga categoria, produto
 * nem mesa: reabrir o tutorial não pode destruir o trabalho feito nele.
 */
export async function restartOnboarding(): Promise<SaveResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_onboarding_progress", {
    p_restaurant_id: restaurant.id,
    p_steps: {},
    p_complete: false,
  });

  if (error) return { ok: false, error: "Não foi possível reiniciar o passo a passo." };

  revalidateOnboarding();
  return { ok: true, message: "Passo a passo reiniciado. Seu cardápio continua igual." };
}

/**
 * Lê o progresso para o componente cliente do wizard.
 *
 * Existe porque o wizard é client component (troca de etapa sem recarregar) e
 * precisa reidratar quando o usuário volta. O dado continua vindo do servidor
 * com a guarda de tenant — o cliente nunca consulta `restaurants` direto.
 */
export async function loadOnboarding() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return null;
  const snapshot = await getOnboardingSnapshot(restaurant.id);
  if (!snapshot) return null;
  return {
    restaurantId: snapshot.restaurantId,
    steps: readProgress(snapshot.steps),
    segment: snapshot.segment,
    completed: snapshot.completed,
    counts: snapshot.counts,
    slug: snapshot.slug,
    status: snapshot.status,
    name: snapshot.name,
    logoUrl: snapshot.logoUrl,
  };
}

/* -------------------------------------------------------------------------- */
/* Informações básicas (etapa 1 do wizard)                                    */
/* -------------------------------------------------------------------------- */

export type InfoResult = { ok: true; message: string } | { ok: false; error: string; fields?: Record<string, string> };

/**
 * Salva nome, descrição e logo do restaurante **sem tocar no slug**.
 *
 * ─── Por que não reutilizar `updateRestaurant` ─────────────────────────────
 *
 * Ela valida `restaurantSchema` inteiro, que exige `slug` no formato final. O
 * wizard não edita o link: mudar `/r/meu-restaurante` no meio da configuração
 * invalidaria o QR Code que o dono acabou de imprimir. Mandar o slug atual em
 * campo escondido funcionaria, mas deixaria aberta a porta para o formulário do
 * wizard trocar o link — e a regra "o link não muda aqui" ficaria só na
 * interface, não no servidor.
 *
 * Aqui o slug é lido do banco e revalidado como está. Se ele já é válido (e é,
 * porque foi validado na criação), a atualização só mexe nos três campos da
 * etapa.
 */
export async function saveOnboardingInfo(input: {
  name: string;
  description?: string | null;
  logoUrl?: string | null;
}): Promise<InfoResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };

  const infoSchema = restaurantSchema
    .pick({ name: true, description: true })
    .extend({ logoUrl: z.string().trim().max(2048).nullable().optional() });

  const parsed = infoSchema.safeParse({
    name: String(input.name ?? "").trim(),
    description: String(input.description ?? "").trim(),
    logoUrl: input.logoUrl ?? null,
  });

  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fields[key]) fields[key] = issue.message;
    }
    return {
      ok: false,
      error: fields.name ?? fields.description ?? "Confira os campos destacados.",
      fields,
    };
  }

  // A logo precisa apontar para o bucket do próprio tenant. A RPC de tema já
  // valida isso; repetir aqui evita gravar URL de outra casa que depois falharia
  // no tema (e o dono veria "não foi possível salvar o tema" sem entender).
  const logoUrl = parsed.data.logoUrl?.trim() || null;
  if (logoUrl) {
    const marker = "/storage/v1/object/public/restaurant-assets/";
    if (!logoUrl.includes(marker) || !logoUrl.includes(`/${restaurant.id}/`)) {
      return { ok: false, error: "A imagem enviada não pertence a este restaurante. Envie novamente." };
    }
  }

  const supabase = await createClient();

  // `.select("id")` é obrigatório: sem ele a RLS filtra em silêncio e a tela
  // mostraria "salvo" sem nada ter mudado (o mesmo erro corrigido na Etapa 2).
  const { error, data } = await supabase
    .from("restaurants")
    .update({
      name: parsed.data.name,
      description: (parsed.data.description ?? "").trim() || null,
      ...(logoUrl !== undefined ? { logo_url: logoUrl } : {}),
    })
    .eq("id", restaurant.id)
    .select("id");

  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "Você não tem permissão para editar este restaurante." };
    }
    return { ok: false, error: "Não foi possível salvar. Tente novamente." };
  }

  if (!data?.length) {
    return { ok: false, error: "Você não tem permissão para editar este restaurante." };
  }

  revalidateOnboarding();
  revalidatePath("/r", "layout");
  return { ok: true, message: "Informações salvas." };
}
