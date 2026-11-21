import { KitchenBoard } from "@/components/kitchen/kitchen-board";
import { KitchenCard } from "@/components/kitchen/kitchen-card";
import type { KitchenOrder } from "@/lib/types";

export { KitchenBoard as Board, KitchenCard as Card };

export const settings = { late_after_minutes: 15, warn_after_minutes: 10 };

type Overrides = Partial<KitchenOrder> & {
  minutesAgo?: number;
  withOptions?: boolean;
};

export function order(overrides: Overrides = {}): KitchenOrder {
  const { minutesAgo = 5, withOptions = false, ...rest } = overrides;
  const created = new Date(Date.now() - minutesAgo * 60_000).toISOString();

  return {
    id: "11111111-1111-1111-1111-111111111111",
    restaurant_id: "r1",
    table_id: "t1",
    table_name: "Mesa 07",
    order_number: 1042,
    status: "pending",
    channel: "dine_in",
    total: 68.8,
    notes: null,
    created_at: created,
    updated_at: created,
    preparing_since:
      rest.status === "preparing" ? new Date(Date.now() - (minutesAgo - 2) * 60_000).toISOString() : null,
    items: [
      {
        id: "i1",
        product_id: "p1",
        name: "X-Bacon",
        quantity: 2,
        subtotal: 50,
        notes: "sem cebola",
        category_id: "c1",
        station_slug: null,
        options: withOptions
          ? [{ group_name: "Remover", name: "sem queijo", price_delta: -2, quantity: 1 }]
          : [],
      },
    ],
    item_count: 2,
    ...rest,
  };
}
