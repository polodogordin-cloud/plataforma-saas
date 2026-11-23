"use server";

import { createClient } from "@/lib/supabase/server";
import { orderInputSchema } from "@/lib/validation";
import { cleanName, isValidPhone, normalizePhone } from "@/lib/loyalty";
import type { CreatedOrder, TableOrder } from "@/lib/types";

/**
 * Criação de pedido — Etapa 6.
 *
 * A regra que define esta etapa: **o cliente só decide o quê e quanto**.
 * O corpo aceito é `{ tableToken, items: [{ product_id, quantity }], notes }`.
 * Nada de preço, subtotal ou total: esses valores vêm do banco, dentro da RPC
 * `create_order`, que valida token/mesa/produto e soma os itens com o preço
 * atual. Mandar `price` no corpo não muda o pedido — o schema descarta e a
 * função nunca lê o campo.
 *
 * A sessão da mesa também não é confiada à tela: o token é revalidado no
 * servidor a cada envio (`resolve_table_token` dentro da RPC), exatamente como
 * combinado na Etapa 4.
 */

export type CreateOrderResult =
  | { ok: true; order: CreatedOrder }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Mensagens da RPC traduzidas para o cliente final. */
const ERROR_MESSAGES: Record<string, string> = {
  table_unavailable: "Esta mesa não está mais disponível. Chame um atendente.",
  product_unavailable:
    "Um dos itens saiu do cardápio agora. Volte ao cardápio e revise o pedido.",
  invalid_quantity: "Quantidade inválida em um dos itens.",
  empty_order: "Seu carrinho está vazio.",
  too_many_items: "Muitos itens diferentes no mesmo pedido.",
  too_many_orders:
    "Você acabou de enviar outro pedido. Espere alguns segundos antes de tentar de novo.",
  notes_too_long: "A observação ficou longa demais.",
  invalid_items: "Não foi possível ler o carrinho. Recarregue a página.",
  invalid_item: "Não foi possível ler o carrinho. Recarregue a página.",
  // Etapa 24 — identificação opcional. As mensagens dizem o que fazer, não o
  // que o banco recusou: "informe um WhatsApp com DDD" resolve, "invalid_phone"
  // não.
  invalid_phone: "Confira o WhatsApp: informe DDD e número.",
  customer_name_too_long: "O nome ficou longo demais.",
  consent_required:
    "Para registrar seus pontos, marque a autorização de uso do seu nome e WhatsApp.",
};

function translate(message: string | undefined, code: string | undefined): string {
  if (message) {
    for (const [key, text] of Object.entries(ERROR_MESSAGES)) {
      if (message.includes(key)) return text;
    }
  }
  if (code === "23505") return "Esse pedido já foi registrado. Aguarde um instante.";
  return "Não foi possível enviar o pedido. Tente novamente.";
}

export async function createOrder(input: unknown): Promise<CreateOrderResult> {
  const parsed = orderInputSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Revise o pedido.",
      fieldErrors,
    };
  }

  const { tableToken, items, notes } = parsed.data;

  /*
   * Identificação — Etapa 24.
   *
   * Só é enviada quando a pessoa preencheu algo E marcou o aceite. Nome de
   * sobra sem consentimento não vai para o banco: lá o pedido inteiro seria
   * recusado (`consent_required`), e transformar isso em "seu pedido falhou"
   * por causa de um campo opcional seria hostil. Aqui a identificação é
   * descartada e o pedido segue anônimo — que é o comportamento da Etapa 6.
   *
   * Quando há identificação, o telefone é validado no app (mensagem imediata) e
   * de novo no banco (PostgREST é porta aberta), com a MESMA regra.
   */
  const wantsIdentification =
    Boolean(parsed.data.consent) &&
    Boolean(parsed.data.customerName.trim() || parsed.data.customerPhone.trim());

  if (wantsIdentification && parsed.data.customerPhone.trim() && !isValidPhone(parsed.data.customerPhone)) {
    return {
      ok: false,
      error: "Confira o WhatsApp: informe DDD e número.",
      fieldErrors: { customerPhone: ["Informe DDD e número."] },
    };
  }

  const customerName = wantsIdentification ? cleanName(parsed.data.customerName) : null;
  const customerPhone = wantsIdentification ? normalizePhone(parsed.data.customerPhone) : null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_order", {
    p_token: tableToken,
    // Só produto e quantidade atravessam a fronteira, como na Etapa 6.
    p_items: items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
    p_notes: notes || null,
    p_customer_name: customerName,
    p_customer_phone: customerPhone,
    p_consent: wantsIdentification,
  });

  if (error) {
    return { ok: false, error: translate(error.message, error.code) };
  }

  const row = (Array.isArray(data) ? data[0] : data) as CreatedOrder | undefined;
  if (!row) {
    return { ok: false, error: "Não foi possível enviar o pedido. Tente novamente." };
  }

  // Os totais podem ter mudado desde que a tela foi carregada (preço novo,
  // item esgotado). Quem decide é o banco: a tela mostra o que ele devolveu.
  return {
    ok: true,
    order: {
      ...row,
      subtotal: Number(row.subtotal),
      total: Number(row.total),
    },
  };
}

/**
 * Relê um pedido pelo número, usando o token da mesa.
 *
 * Serve para a tela de sucesso sobreviver a um recarregamento (o celular pode
 * ter sido bloqueado, a rede pode cair) e para acompanhar o status. A RPC só
 * devolve pedidos **daquela mesa**: o token é a credencial, e o número não
 * abre nada de outra mesa.
 */
export async function readTableOrder(
  tableToken: string,
  orderNumber: number,
): Promise<TableOrder | null> {
  if (!/^[2-9A-HJKMNP-Z]{10,64}$/i.test(tableToken.trim())) return null;
  if (!Number.isInteger(orderNumber) || orderNumber <= 0) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_table_order", {
    p_token: tableToken.trim(),
    p_order_number: orderNumber,
  });

  if (error || !data) return null;

  const row = (Array.isArray(data) ? data[0] : data) as
    | (Omit<TableOrder, "items" | "subtotal" | "fees" | "discount" | "total"> & {
        items: TableOrder["items"];
        subtotal: number | string;
        fees: number | string;
        discount: number | string;
        total: number | string;
      })
    | undefined;

  if (!row) return null;

  return {
    ...row,
    subtotal: Number(row.subtotal),
    fees: Number(row.fees),
    discount: Number(row.discount),
    total: Number(row.total),
    items: (row.items ?? []).map((item) => ({
      ...item,
      unit_price: Number(item.unit_price),
      subtotal: Number(item.subtotal),
    })),
  };
}
