"use server";

import { revalidatePath } from "next/cache";
import { trackOnboardingStep } from "@/lib/onboarding-progress";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveRestaurant } from "@/lib/data/restaurants";
import { getWhatsappSettings } from "@/lib/data/whatsapp";
import {
  DEFAULT_WHATSAPP_MESSAGE,
  WHATSAPP_MESSAGE_MAX,
  normalizeWhatsappConfig,
  normalizeWhatsappNumber,
  type WhatsappConfig,
} from "@/lib/whatsapp";

/**
 * Ações do WhatsApp do restaurante — Etapa 13.
 *
 * Regras que este arquivo garante:
 *
 *  1. **O restaurante vem do servidor**, nunca do corpo da requisição. Mesmo que
 *     o navegador mande outro `restaurantId`, ele é ignorado — quem manda é o
 *     vínculo ativo de `getActiveRestaurant`.
 *  2. **Validação em duas camadas**: Zod aqui (mensagem boa para a tela) e
 *     `save_whatsapp_settings` no banco (recusa número inválido, ativo sem
 *     número, mensagem acima do teto e qualquer escrito por quem não é admin).
 *  3. **O número é normalizado antes de sair daqui.** O banco também normaliza,
 *     mas mandar o texto cru faria a mensagem de erro depender do banco. As duas
 *     implementações da mesma regra têm teste (`whatsapp-lib.cjs`).
 *  4. **Revalidação do cardápio público**: `/r/{slug}` tem `revalidate = 60`, e
 *     sem isso o cliente veria o cardápio sem o botão por até um minuto depois
 *     de o dono ligar.
 */

const phoneField = z
  .string()
  .trim()
  .max(32, "Telefone muito longo.")
  .optional()
  .default("");

const messageField = z
  .string()
  .trim()
  .max(WHATSAPP_MESSAGE_MAX, `A mensagem pode ter no máximo ${WHATSAPP_MESSAGE_MAX} caracteres.`)
  .optional()
  .default("");

const whatsappSchema = z
  .object({
    phone: phoneField,
    message: messageField,
    isActive: z.boolean(),
  })
  .superRefine((data, ctx) => {
    const raw = data.phone.trim();

    // Campo vazio é permitido enquanto o canal está desligado: o dono pode
    // apagar o número para desativar. Ligar sem número é que não faz sentido.
    if (!raw) {
      if (data.isActive) {
        ctx.addIssue({
          code: "custom",
          path: ["phone"],
          message: "Informe o número de WhatsApp para ativar.",
        });
      }
      return;
    }

    if (!normalizeWhatsappNumber(raw)) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Número inválido. Use DDD + número, ex.: (11) 99999-0000.",
      });
    }
  });

export type SaveWhatsappResult =
  | { ok: true; config: WhatsappConfig; message: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Traduz o erro da RPC para algo que o dono do restaurante entenda. */
function translateError(message: string | undefined): string {
  if (message?.includes("whatsapp_forbidden")) {
    return "Você não tem permissão para configurar o WhatsApp desta casa.";
  }
  if (message?.includes("invalid_whatsapp_phone")) {
    return "Número inválido. Use DDD + número, ex.: (11) 99999-0000.";
  }
  if (message?.includes("whatsapp_phone_required")) {
    return "Informe o número de WhatsApp antes de ativar.";
  }
  if (message?.includes("invalid_whatsapp_message")) {
    return `A mensagem pode ter no máximo ${WHATSAPP_MESSAGE_MAX} caracteres.`;
  }
  return "Não foi possível salvar o WhatsApp. Tente novamente.";
}

/**
 * Salva a configuração.
 *
 * Recebe um objeto (não `FormData`) porque o formulário tem estado de
 * interruptor controlado e prévia do link — mesmo padrão de `saveTheme`.
 */
export async function saveWhatsappSettings(input: {
  phone: string;
  message: string;
  isActive: boolean;
}): Promise<SaveWhatsappResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) {
    return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };
  }

  const parsed = whatsappSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    return {
      ok: false,
      error: fieldErrors.phone?.[0] ?? fieldErrors.message?.[0] ?? "Confira os campos destacados.",
      fieldErrors,
    };
  }

  const digits = normalizeWhatsappNumber(parsed.data.phone);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_whatsapp_settings", {
    p_restaurant_id: restaurant.id,
    p_phone: digits,
    p_message: parsed.data.message,
    p_is_active: parsed.data.isActive,
  });

  if (error) {
    return { ok: false, error: translateError(error.message) };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const config = normalizeWhatsappConfig({
    phone: (row as { phone?: string | null } | null)?.phone ?? digits,
    message:
      (row as { message?: string | null } | null)?.message ??
      parsed.data.message ??
      DEFAULT_WHATSAPP_MESSAGE,
    is_active: (row as { is_active?: boolean } | null)?.is_active ?? parsed.data.isActive,
  });

  // O cardápio público é ISR: sem isto, o botão novo só apareceria no próximo
  // minuto — e o dono acharia que não salvou.
  revalidatePath(`/r/${restaurant.slug}`);
  revalidatePath("/app/configuracoes/whatsapp");
  revalidatePath("/app/configuracoes");

  // Etapa 21: só marca a etapa do wizard quando existe número configurado —
  // "salvei a tela em branco" não é WhatsApp conectado.
  if (config.phone) void trackOnboardingStep("whatsapp");

  return {
    ok: true,
    config,
    message: config.isActive
      ? "WhatsApp ativado no cardápio."
      : "WhatsApp desativado. O botão saiu do cardápio.",
  };
}

/**
 * Desliga o canal sem apagar número nem mensagem.
 *
 * Existe separado porque "desativar" no meio de um serviço precisa ser um toque
 * só — e é o que o dono procura quando o celular da loja fica sem bateria.
 */
export async function deactivateWhatsapp(): Promise<SaveWhatsappResult> {
  const restaurant = await getActiveRestaurant();
  if (!restaurant) {
    return { ok: false, error: "Nenhum restaurante ativo nesta sessão." };
  }

  const current = await getWhatsappSettings(restaurant.id);

  return saveWhatsappSettings({
    // `phone` já normalizado; se não houver, o número fica vazio.
    phone: current.phone ?? "",
    message: current.message ?? DEFAULT_WHATSAPP_MESSAGE,
    isActive: false,
  });
}
