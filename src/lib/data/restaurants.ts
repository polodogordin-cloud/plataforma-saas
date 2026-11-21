import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type {
  ActiveRestaurant,
  Restaurant,
  RestaurantMembership,
  UserProfile,
} from "@/lib/types";

/** Usuário autenticado (validado no servidor via Supabase Auth). */
export async function getSessionUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, email, full_name, avatar_url, phone, created_at, updated_at")
    .eq("id", userId)
    .maybeSingle();
  return data as UserProfile | null;
}

/**
 * Restaurantes do usuário logado. A RLS filtra automaticamente pelo vínculo
 * em restaurant_users, então esta consulta nunca enxerga outro tenant.
 */
export async function listMyRestaurants(): Promise<ActiveRestaurant[]> {
  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from("restaurant_users")
    .select("restaurant_id, role, status")
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (!memberships?.length) return [];

  const ids = memberships.map((m) => m.restaurant_id as string);

  const { data: restaurants } = await supabase
    .from("restaurants")
    .select("*")
    .in("id", ids)
    .order("created_at", { ascending: true });

  if (!restaurants?.length) return [];

  const roleByRestaurant = new Map(
    (memberships as RestaurantMembership[]).map((m) => [m.restaurant_id, m.role]),
  );

  return (restaurants as Restaurant[]).map((restaurant) => ({
    ...restaurant,
    role: roleByRestaurant.get(restaurant.id) ?? "staff",
  }));
}

/**
 * Primeiro restaurante do usuário — base do painel.
 *
 * Devolve também restaurantes suspensos (Etapa 10): é o layout do painel que
 * decide mostrar a tela de bloqueio com o motivo. Filtrar aqui esconderia a
 * casa e o dono veria um "restaurante não encontrado", que parece bug.
 */
export async function getActiveRestaurant(): Promise<ActiveRestaurant | null> {
  const restaurants = await listMyRestaurants();
  return restaurants[0] ?? null;
}

export type RestaurantCounters = {
  categories: number;
  products: number;
  tables: number;
  pendingOrders: number;
};

/** Contadores do dashboard (Etapas 2/4/7 preenchem estes números). */
export async function getRestaurantCounters(restaurantId: string): Promise<RestaurantCounters> {
  const supabase = await createClient();

  const countOf = async (table: string, filter?: Record<string, string>) => {
    let query = supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId);
    if (filter) {
      for (const [column, value] of Object.entries(filter)) query = query.eq(column, value);
    }
    const { count, error } = await query;
    // Tabela ainda não existe (etapa futura): trata como zero.
    if (error) return 0;
    return count ?? 0;
  };

  const [categories, products, tables, pendingOrders] = await Promise.all([
    countOf("categories"),
    countOf("products"),
    countOf("tables"),
    countOf("orders", { status: "pending" }),
  ]);

  return { categories, products, tables, pendingOrders };
}
