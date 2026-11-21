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

/* ==========================================================================
   Etapa 2 · Categorias e produtos
   ========================================================================== */

export type Category = {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

export type Product = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_available: boolean;
  is_featured: boolean;
  internal_code: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

/** Categoria + seus produtos, na ordem de exibição. */
export type CategoryWithProducts = Category & { products: Product[] };

/* ==========================================================================
   Etapa 3 · Cardápio público
   ========================================================================== */

/**
 * Cabeçalho do cardápio público. Vem de `public_restaurants`, que já filtra
 * restaurante publicado e NÃO inclui telefone, endereço nem dados de equipe.
 */
export type PublicRestaurant = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  description: string | null;
  city: string | null;
  state: string | null;
  currency: string;
  status: RestaurantStatus;
  settings: Record<string, unknown>;
};

/** Produto exibido ao cliente: sem código interno, disponibilidade ou timestamps. */
export type PublicProduct = {
  id: string;
  restaurant_id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_featured: boolean;
  position: number;
};

export type PublicCategory = {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  position: number;
};

/** Categoria + produtos pronta para renderizar o cardápio público. */
export type PublicMenuSection = PublicCategory & { products: PublicProduct[] };

/** Cardápio público já organizado para a tela. */
export type PublicMenu = {
  sections: PublicMenuSection[];
  /** Destaques para a faixa da capa. */
  featured: PublicProduct[];
  counts: { categories: number; products: number };
};

/**
 * Horário de funcionamento — Etapa 3.
 *
 * Guardado em `restaurants.settings` (jsonb já existente), sem migração nova:
 *
 *   settings = {
 *     "opening_hours": {
 *       "mon": { "closed": false, "open": "18:00", "close": "23:30" },
 *       "tue": { ... }, ... até "sun"
 *     }
 *   }
 *
 * Enquanto `opening_hours` não existir, o cardápio não afirma nada sobre
 * horário — evita dizer "aberto" sem saber.
 */
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type DayHours = { closed: boolean; open: string; close: string };

export type OpeningHours = Partial<Record<Weekday, DayHours>>;

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Segunda",
  tue: "Terça",
  wed: "Quarta",
  thu: "Quinta",
  fri: "Sexta",
  sat: "Sábado",
  sun: "Domingo",
};

/** Status de abertura calculado a partir do horário + status comercial. */
export type OpeningState = {
  /** Situação para o cliente. */
  state: "open" | "closed" | "away";
  /** Texto curto, ex.: "Aberto até 23:30". */
  label: string;
  /** Detalhe secundário, ex.: "Abre hoje às 18:00". */
  detail?: string;
};
