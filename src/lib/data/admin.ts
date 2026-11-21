import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type {
  AdminAuditRow,
  AdminDashboard,
  AdminOrderRow,
  AdminRestaurantDetail,
  AdminRestaurantRow,
  AdminStatusFilter,
  AdminUserRow,
  Plan,
} from "@/lib/types";

/**
 * Leitura do painel master — Etapa 10.
 *
 * **Todas** as consultas passam por RPC `security definer` guardada por
 * `is_platform_admin()`. Não existe aqui uma única consulta direta às tabelas:
 * se amanhã um destes `select` for copiado para outra tela, ele não vira uma
 * porta aberta — a função do banco confere o papel de novo, e a RLS segue
 * fechada por tenant.
 *
 * `isPlatformAdmin()` é o único **pré-cheque** da camada de UI. Ele não
 * autoriza nada: serve para redirecionar cedo e não renderizar esqueleto de
 * painel para quem não tem acesso.
 */

export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) return false;
  return data === true;
});

export const getAdminDashboard = cache(async (): Promise<AdminDashboard | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_dashboard");
  if (error) return null;

  const row = (Array.isArray(data) ? data[0] : data) as AdminDashboard | undefined;
  if (!row) return null;

  // PostgREST devolve integer como número, mas normalizamos por segurança.
  return {
    restaurants_total: Number(row.restaurants_total ?? 0),
    restaurants_active: Number(row.restaurants_active ?? 0),
    restaurants_inactive: Number(row.restaurants_inactive ?? 0),
    restaurants_suspended: Number(row.restaurants_suspended ?? 0),
    products_total: Number(row.products_total ?? 0),
    tables_total: Number(row.tables_total ?? 0),
    orders_total: Number(row.orders_total ?? 0),
    orders_today: Number(row.orders_today ?? 0),
    users_total: Number(row.users_total ?? 0),
  };
});

/**
 * Lista de restaurantes com busca e filtro.
 *
 * Busca vazia vira `null` para a RPC não montar um `like '%%'` (que funciona,
 * mas esconde a intenção). O filtro "all" também vira `null`.
 */
export async function listAdminRestaurants(options?: {
  search?: string | null;
  status?: AdminStatusFilter;
}): Promise<AdminRestaurantRow[]> {
  const supabase = await createClient();
  const search = options?.search?.trim() || null;
  const status = options?.status && options.status !== "all" ? options.status : null;

  const { data, error } = await supabase.rpc("admin_list_restaurants", {
    p_search: search,
    p_status: status,
  });

  if (error || !data) return [];

  return (data as unknown as AdminRestaurantRow[]).map((row) => ({
    ...row,
    products_count: Number(row.products_count ?? 0),
    tables_count: Number(row.tables_count ?? 0),
    members_count: Number(row.members_count ?? 0),
    orders_count: Number(row.orders_count ?? 0),
  }));
}

export const getAdminRestaurantDetail = cache(
  async (restaurantId: string): Promise<AdminRestaurantDetail | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_restaurant_detail", {
      p_restaurant_id: restaurantId,
    });

    if (error || !data) return null;

    const detail = data as unknown as AdminRestaurantDetail;

    // `numeric` chega como string pelo PostgREST: convertemos nos pontos onde
    // o valor é exibido como preço.
    return {
      ...detail,
      products: detail.products.map((product) => ({
        ...product,
        price: Number(product.price),
      })),
      orders: detail.orders.map((order) => ({
        ...order,
        total: Number(order.total),
      })),
    };
  },
);

export async function listAdminUsers(search?: string | null): Promise<AdminUserRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_users", {
    p_search: search?.trim() || null,
  });

  if (error || !data) return [];
  return data as unknown as AdminUserRow[];
}

export async function listAdminOrders(limit = 30): Promise<AdminOrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_orders", { p_limit: limit });

  if (error || !data) return [];

  return (data as unknown as AdminOrderRow[]).map((row) => ({
    ...row,
    total: Number(row.total),
  }));
}

export async function listAdminAudit(limit = 50): Promise<AdminAuditRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_audit", { p_limit: limit });

  if (error || !data) return [];
  return data as unknown as AdminAuditRow[];
}

/** Catálogo de planos (Etapa 11 vai usar a mesma leitura). */
export const listPlans = cache(async (): Promise<Plan[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("plans")
    .select("id, name, description, price_monthly, features, is_active, position")
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (error || !data) return [];

  return (data as unknown as Plan[]).map((plan) => ({
    ...plan,
    price_monthly: Number(plan.price_monthly),
    features: Array.isArray(plan.features) ? plan.features : [],
  }));
});
