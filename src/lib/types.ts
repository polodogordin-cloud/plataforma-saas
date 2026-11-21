/** Tipos de domínio da Etapa 1. Espelham o schema em supabase/migrations. */

export type RestaurantStatus = "draft" | "published" | "paused" | "closed";
export type RestaurantRole = "owner" | "admin" | "staff";
export type MemberStatus = "active" | "invited" | "suspended";

export type UserProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

export type Restaurant = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  description: string | null;
  phone: string | null;
  address_line: string | null;
  address_number: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  status: RestaurantStatus;
  timezone: string;
  currency: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type RestaurantMembership = {
  id: string;
  restaurant_id: string;
  user_id: string;
  role: RestaurantRole;
  status: MemberStatus;
  created_at: string;
};

/** Restaurante + papel do usuário logado (contexto de sessão). */
export type ActiveRestaurant = Restaurant & { role: RestaurantRole };

export const RESTAURANT_STATUS_LABEL: Record<RestaurantStatus, string> = {
  draft: "Rascunho",
  published: "Publicado",
  paused: "Pausado",
  closed: "Fechado",
};

export const RESTAURANT_ROLE_LABEL: Record<RestaurantRole, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  staff: "Equipe",
};
