import { PrintConfigForm } from "@/components/printing/print-config-form";
import { PrintTestPanel } from "@/components/printing/print-test-panel";
import { ThermalTicket, OrderTicket } from "@/components/printing/thermal-ticket";
import { buildTicketLines, buildTestLines } from "@/lib/printing";
import type { PrintConfig, PrintOrderDocument } from "@/lib/types";

export {
  PrintConfigForm,
  PrintTestPanel,
  ThermalTicket,
  OrderTicket,
  buildTicketLines,
  buildTestLines,
};

export function config(overrides: Partial<PrintConfig> = {}): PrintConfig {
  return {
    settings: {
      mode: "manual",
      default_paper_width: "80",
      print_orders: true,
      print_tickets: true,
      print_kitchen: true,
      print_counter: true,
      copies: 1,
      footer_note: null,
    },
    profiles: [],
    printers: [],
    can_configure: true,
    ...overrides,
  };
}

export function sampleDocument(
  overrides: Partial<PrintOrderDocument["order"]> = {},
): PrintOrderDocument {
  return {
    restaurant: {
      id: "r1",
      name: "Famintos Burger",
      phone: null,
      address: null,
      city: null,
      timezone: "America/Sao_Paulo",
    },
    settings: {
      mode: "manual",
      default_paper_width: "80",
      copies: 1,
      footer_note: null,
      show_prices: true,
    },
    order: {
      id: "o1",
      order_number: 1042,
      status: "confirmed",
      channel: "dine_in",
      table_name: "Mesa 07",
      subtotal: 45,
      fees: 0,
      discount: 0,
      total: 45,
      notes: null,
      created_at: "2026-11-21T21:00:00Z",
      updated_at: "2026-11-21T21:00:00Z",
      items: [
        { name: "X-Bacon", quantity: 2, unit_price: 20, subtotal: 40, notes: null, options: [] },
        { name: "Coca-Cola", quantity: 1, unit_price: 5, subtotal: 5, notes: null, options: [] },
      ],
      payments: [],
      ...overrides,
    },
  };
}
