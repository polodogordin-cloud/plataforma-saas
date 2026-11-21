import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  PaperWidth,
  PrintConfig,
  PrintOrderDocument,
  PrintProfile,
  PrintProfileKind,
  PrintProviderKind,
  PrintSettings,
  Printer,
} from "@/lib/types";
import { normalizeCopies, normalizePaperWidth } from "@/lib/printing";

/**
 * Leitura da impressão — Etapa 18.
 *
 * Duas portas, e a diferença entre elas importa:
 *
 *   • `getPrintConfig` lê a configuração da casa (perfis, impressoras, modo).
 *     Só membro com `print_can_view`; a RPC recusa o resto.
 *   *  `getPrintOrder` monta o **documento do pedido** para o papel, com
 *     pagamentos reais do livro da Etapa 16.
 *
 * Nada aqui consulta `orders` direto: a RPC é a única que sabe juntar item,
 * adicional, observação e pagamento sem vazar pedido de outra casa.
 */

const EMPTY_SETTINGS: PrintSettings = {
  mode: "manual",
  default_paper_width: "80",
  print_orders: true,
  print_tickets: true,
  print_kitchen: true,
  print_counter: true,
  copies: 1,
  footer_note: null,
};

const EMPTY_CONFIG: PrintConfig = {
  settings: EMPTY_SETTINGS,
  profiles: [],
  printers: [],
  can_configure: false,
};

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeSettings(raw: Record<string, unknown>): PrintSettings {
  return {
    mode: raw.mode === "auto" ? "auto" : "manual",
    default_paper_width: normalizePaperWidth(raw.default_paper_width),
    // `!== false` e não `=== true`: coluna ausente deve herdar o padrão do
    // banco (ligado), como em `print_settings`.
    print_orders: raw.print_orders !== false,
    print_tickets: raw.print_tickets !== false,
    print_kitchen: raw.print_kitchen !== false,
    print_counter: raw.print_counter !== false,
    copies: normalizeCopies(raw.copies),
    footer_note: (raw.footer_note as string | null) ?? null,
  };
}

function normalizeProfile(raw: Record<string, unknown>): PrintProfile {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    slug: String(raw.slug ?? ""),
    kind: (raw.kind as PrintProfileKind) ?? "kitchen",
    paper_width: normalizePaperWidth(raw.paper_width),
    copies: normalizeCopies(raw.copies),
    is_active: raw.is_active !== false,
    sort_order: Number(raw.sort_order ?? 0),
  };
}

function normalizePrinter(raw: Record<string, unknown>): Printer {
  return {
    id: String(raw.id ?? ""),
    profile_id: (raw.profile_id as string | null) ?? null,
    name: String(raw.name ?? ""),
    provider: (raw.provider as PrintProviderKind) ?? "browser",
    identifier: (raw.identifier as string | null) ?? null,
    paper_width: normalizePaperWidth(raw.paper_width),
    is_default: raw.is_default === true,
    is_active: raw.is_active !== false,
    notes: (raw.notes as string | null) ?? null,
  };
}

/**
 * Configuração da casa.
 *
 * Nunca lança: erro de permissão vira `EMPTY_CONFIG` com `can_configure: false`.
 * A tela mostra o formulário desabilitado em vez de um erro branco — e a
 * escrita continua recusada no banco de qualquer forma.
 */
export async function getPrintConfig(restaurantId: string): Promise<PrintConfig> {
  if (!restaurantId) return EMPTY_CONFIG;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_print_config", {
    p_restaurant_id: restaurantId,
  });

  if (error || !data) return EMPTY_CONFIG;

  const payload = asRecord(data);
  const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  const printers = Array.isArray(payload.printers) ? payload.printers : [];

  return {
    settings: normalizeSettings(asRecord(payload.settings)),
    profiles: profiles.map((row) => normalizeProfile(asRecord(row))),
    printers: printers.map((row) => normalizePrinter(asRecord(row))),
    can_configure: payload.can_configure === true,
  };
}

/**
 * Documento do pedido para o papel.
 *
 * `null` = pedido inexistente ou de outro restaurante. A RPC devolve o mesmo
 * erro nos dois casos de propósito: quem não é da casa não descobre que o
 * pedido existe.
 */
export async function getPrintOrder(orderId: string): Promise<PrintOrderDocument | null> {
  if (!orderId) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_print_order", { p_order_id: orderId });

  if (error || !data) return null;

  const payload = asRecord(data);
  const restaurant = asRecord(payload.restaurant);
  const settings = asRecord(payload.settings);
  const order = asRecord(payload.order);

  const items = Array.isArray(order.items) ? order.items : [];
  const payments = Array.isArray(order.payments) ? order.payments : [];

  return {
    restaurant: {
      id: String(restaurant.id ?? ""),
      name: String(restaurant.name ?? ""),
      phone: (restaurant.phone as string | null) ?? null,
      address: (restaurant.address as string | null) ?? null,
      city: (restaurant.city as string | null) ?? null,
      timezone: String(restaurant.timezone ?? "America/Sao_Paulo"),
    },
    settings: {
      mode: settings.mode === "auto" ? "auto" : "manual",
      default_paper_width: normalizePaperWidth(settings.default_paper_width) as PaperWidth,
      copies: normalizeCopies(settings.copies),
      footer_note: (settings.footer_note as string | null) ?? null,
      show_prices: settings.show_prices !== false,
    },
    order: {
      id: String(order.id ?? ""),
      order_number: Number(order.order_number ?? 0),
      status: order.status as PrintOrderDocument["order"]["status"],
      channel: order.channel as PrintOrderDocument["order"]["channel"],
      table_name: String(order.table_name ?? ""),
      subtotal: toNumber(order.subtotal),
      fees: toNumber(order.fees),
      discount: toNumber(order.discount),
      total: toNumber(order.total),
      notes: (order.notes as string | null) ?? null,
      created_at: String(order.created_at ?? ""),
      updated_at: String(order.updated_at ?? ""),
      items: items.map((row) => {
        const item = asRecord(row);
        const options = Array.isArray(item.options) ? item.options : [];
        return {
          name: String(item.name ?? ""),
          quantity: Number(item.quantity ?? 0),
          unit_price: toNumber(item.unit_price),
          subtotal: toNumber(item.subtotal),
          notes: (item.notes as string | null) ?? null,
          options: options.map((optionRow) => {
            const option = asRecord(optionRow);
            return {
              group_name: String(option.group_name ?? ""),
              name: String(option.name ?? ""),
              price_delta: toNumber(option.price_delta),
              quantity: Number(option.quantity ?? 1),
            };
          }),
        };
      }),
      // Espelha o filtro da RPC: só recebimento real, só status `paid`.
      payments: payments
        .map((row) => asRecord(row))
        .map((payment) => ({
          method: payment.method as PrintOrderDocument["order"]["payments"][number]["method"],
          amount: toNumber(payment.amount),
          paid_at: String(payment.paid_at ?? ""),
        }))
        .filter((payment) => payment.amount > 0 && Boolean(payment.method)),
    },
  };
}
