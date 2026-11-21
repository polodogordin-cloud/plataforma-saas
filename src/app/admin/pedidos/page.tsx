import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { Badge } from "@/components/ui/card";
import { listAdminOrders } from "@/lib/data/admin";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { formatPrice } from "@/lib/validation";

export const metadata: Metadata = { title: "Pedidos" };
export const dynamic = "force-dynamic";

/**
 * Pedidos recentes de toda a plataforma.
 *
 * É uma visão de leitura, não o painel operacional: cada casa continua com o
 * próprio `/app/pedidos`. Aqui o suporte responde "o sistema está recebendo
 * pedidos?" e "de onde vem o volume?" — por isso a lista mostra o restaurante
 * em primeiro plano e o status em segundo.
 */
const STATUS_TONE: Record<OrderStatus, "success" | "warning" | "info" | "neutral" | "muted"> = {
  pending: "warning",
  confirmed: "info",
  preparing: "info",
  ready: "success",
  delivered: "neutral",
  cancelled: "muted",
};

export default async function AdminOrdersPage() {
  const orders = await listAdminOrders(50);

  return (
    <>
      <AdminHeader
        title="Pedidos"
        subtitle={`${orders.length} ${orders.length === 1 ? "pedido recente" : "pedidos recentes"}`}
      />

      <main className="app-shell px-4 py-4">
        {orders.length === 0 ? (
          <div className="card px-5 py-9 text-center">
            <ClipboardList className="mx-auto size-6 text-ink-300" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-ink-700">Nenhum pedido ainda</p>
            <p className="mt-1 text-sm text-ink-500">
              Pedidos feitos pelo QR Code ou pela TAG NFC aparecem aqui assim que
              a primeira mesa pedir.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {orders.map((order) => (
              <li key={order.id} className="card flex items-start gap-3 p-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink-100 text-[0.7rem] font-bold tabular-nums text-ink-600">
                  #{order.order_number}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/admin/restaurantes/${order.restaurant_id}`}
                      className="-my-1 inline-flex min-h-11 items-center truncate text-sm font-semibold text-ink-900 hover:underline"
                    >
                      {order.restaurant_name}
                    </Link>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-800">
                      {formatPrice(order.total)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={STATUS_TONE[order.status]}>
                      {ORDER_STATUS_LABEL[order.status]}
                    </Badge>
                    <span className="text-[0.7rem] text-ink-500">
                      {order.table_name ?? "Sem mesa"} · {formatDate(order.created_at)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
