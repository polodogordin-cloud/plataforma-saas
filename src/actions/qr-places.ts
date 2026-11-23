"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getQrPlaceSnapshot } from "@/lib/data/qr-place";
import {
  clampStyleToFormat,
  normalizePlaceStyle,
  validatePlaceStyle,
  type PlaceStyle,
} from "@/lib/place-card";

/**
 * Server Actions do gerador de plaquinhas — Etapa 22.
 *
 * ─── O que o cliente pode mandar ──────────────────────────────────────────
 *
 * Só a **arte**: cores, tamanho do QR, margem, modelo e o que exibir. Nunca a
 * URL do QR, nunca o token, nunca o `restaurant_id`. A URL é montada no servidor
 * a partir do slug e do token lidos do banco — se ela viesse do navegador, um
 * dono poderia salvar uma placa apontando para o site de outra pessoa, e a tela
 * de preview mostraria o domínio alheio como se fosse o dele.
 *
 * ─── Duas camadas de validação ────────────────────────────────────────────
 *
 * `normalizePlaceStyle` corrige o que dá para corrigir (número fora da faixa,
 * cor em formato inesperado) e `validatePlaceStyle` recusa o que **não** pode
 * ser corrigido sem virar outra decisão: contraste insuficiente entre QR e
 * fundo, texto ilegível. A rota de download repete a mesma checagem — é o que
 * impede um PDF ilegível de sair por chamada direta à URL.
 */

export type PlaceActionResult =
  | { ok: true; style: PlaceStyle; message?: string }
  | { ok: false; error: string; style?: PlaceStyle };

/** Só owner/admin mexem na arte padrão da casa. */
async function requirePlaceEditor() {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) return { error: "Restaurante não encontrado." as const };
  if (restaurant.role !== "owner" && restaurant.role !== "admin") {
    return { error: "Seu perfil não tem permissão para personalizar as plaquinhas." as const };
  }
  return { restaurant };
}

/**
 * A cor do texto precisa contrastar com o fundo **e** a placa precisa continuar
 * legível — mas não exigimos que a placa inteira seja branca. Quem escolhe
 * fundo escuro recebe texto claro; o que não passa é QR cinza-claro em fundo
 * branco.
 */
const styleSchema = z.object({
  qrDark: z.string().trim().max(32),
  qrLight: z.string().trim().max(32),
  background: z.string().trim().max(32),
  text: z.string().trim().max(32),
  qrSizeMm: z.number().finite(),
  marginMm: z.number().finite(),
  showLogo: z.boolean(),
  showRestaurant: z.boolean(),
  showTable: z.boolean(),
  format: z.enum(["square", "card", "tent"]),
  template: z.enum(["simples", "aponte", "peca-pelo-celular", "mesa", "mesa-nfc"]),
});

/**
 * Salva a arte padrão da casa.
 *
 * A RPC do banco (`save_qr_place_style`) confere `is_restaurant_owner` de novo e
 * limita o JSON a 4 KB. Aqui a checagem de papel existe para dar a mensagem
 * certa e evitar uma ida ao banco que já sabemos que falharia.
 */
export async function savePlaceStyle(input: unknown): Promise<PlaceActionResult> {
  const guard = await requirePlaceEditor();
  if ("error" in guard) return { ok: false, error: String(guard.error) };

  const parsed = styleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Não foi possível ler as opções da plaquinha." };
  }

  // Normaliza (fronteira de confiança) e depois encaixa no formato escolhido:
  // mudar de "cartão" para "quadrado" com o mesmo QR é uma decisão legítima que
  // só precisa de um ajuste de tamanho, não de um erro.
  const style = clampStyleToFormat(normalizePlaceStyle(parsed.data));
  const validation = validatePlaceStyle(style);
  if (!validation.ok) {
    // `style` volta junto para a tela poder mostrar o preview recusado — o dono
    // vê exatamente o que ficaria ruim, em vez de um erro sem contexto.
    return { ok: false, error: validation.problems[0]!, style };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_qr_place_style", {
    p_restaurant_id: guard.restaurant.id,
    p_style: style,
  });

  if (error) {
    if (error.message?.includes("qr_style_forbidden")) {
      return { ok: false, error: "Seu perfil não pode alterar a arte das plaquinhas." };
    }
    if (error.message?.includes("qr_style_too_large")) {
      return { ok: false, error: "A arte ficou grande demais para salvar." };
    }
    return { ok: false, error: "Não foi possível salvar a arte. Tente novamente." };
  }

  revalidatePath("/app/mesas/qrcodes");
  revalidatePath("/app/mesas");
  return { ok: true, style, message: "Arte salva para todas as mesas." };
}

/** Volta para a arte padrão (preto no branco, formato cartão, "Aponte a câmera"). */
export async function resetPlaceStyle(): Promise<PlaceActionResult> {
  const guard = await requirePlaceEditor();
  if ("error" in guard) return { ok: false, error: String(guard.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_qr_place_style", {
    p_restaurant_id: guard.restaurant.id,
    // `null` = "sem arte salva"; a leitura cai no DEFAULT_PLACE_STYLE. Guardar o
    // objeto padrão criaria duas fontes para o mesmo valor e ele voltaria
    // desatualizado se o padrão mudasse numa versão futura.
    p_style: null,
  });

  if (error) return { ok: false, error: "Não foi possível restaurar a arte padrão." };

  revalidatePath("/app/mesas/qrcodes");
  revalidatePath("/app/mesas");

  const snapshot = await getQrPlaceSnapshot(guard.restaurant.id);
  return {
    ok: true,
    style: snapshot?.style ?? normalizePlaceStyle(null),
    message: "Arte padrão restaurada.",
  };
}

/**
 * Regenera o token de uma mesa — destrutivo para material impresso.
 *
 * Reaproveita `rotateTableToken` (Etapa 5), que já valida o vínculo da mesa com
 * o restaurante do usuário e mantém o token anterior por uma janela de
 * tolerância. A tela chama isto depois de um aviso explícito, com a lista do que
 * deixa de funcionar — mas a decisão de gravar é do servidor.
 */
export async function regeneratePlaceToken(tableId: string) {
  const guard = await requirePlaceEditor();
  if ("error" in guard) return { ok: false as const, error: guard.error };

  const snapshot = await getQrPlaceSnapshot(guard.restaurant.id);
  if (!snapshot) return { ok: false as const, error: "Restaurante não encontrado." };

  const table = snapshot.tables.find((item) => item.id === tableId);
  if (!table) return { ok: false as const, error: "Mesa não encontrada." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rotate_table_token", {
    p_table_id: table.id,
    // 30 minutos: quem está com o cardápio aberto no celular não é expulso no
    // meio do pedido; quem tem o papel impresso na parede precisa trocar.
    p_grace_minutes: 30,
  });

  if (error) return { ok: false as const, error: "Não foi possível gerar um novo QR Code." };

  const row = (Array.isArray(data) ? data[0] : data) as { public_token?: string } | undefined;
  if (!row?.public_token) {
    return { ok: false as const, error: "Não foi possível gerar um novo QR Code." };
  }

  revalidatePath("/app/mesas/qrcodes");
  revalidatePath("/app/mesas");
  return { ok: true as const, token: row.public_token };
}
