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

/* ==========================================================================
   Etapa 4 · Mesas e QR Codes
   ========================================================================== */

/** Ocupação no salão. Independente de `is_active` (que é visibilidade). */
export type TableStatus = "free" | "occupied" | "reserved" | "inactive";

export const TABLE_STATUS_LABEL: Record<TableStatus, string> = {
  free: "Livre",
  occupied: "Ocupada",
  reserved: "Reservada",
  inactive: "Fora de uso",
};

export type RestaurantTable = {
  id: string;
  restaurant_id: string;
  name: string;
  code: string | null;
  notes: string | null;
  /** Base da URL pública do QR Code e da TAG NFC. Nunca exposto ao cliente. */
  public_token: string;
  is_active: boolean;
  status: TableStatus;
  created_at: string;
  updated_at: string;
};

/**
 * Contexto resolvido a partir do token. É o mínimo que a página pública
 * precisa: o restaurante, o rótulo da mesa e o id interno (usado só no
 * servidor, para a Etapa 6 amarrar o pedido à mesa certa).
 */
export type TableContext = {
  restaurant_id: string;
  table_id: string;
  table_name: string;
};

/* ==========================================================================
 * NFC (Etapa 5)
 * ========================================================================== */

/**
 * Estado de uma TAG NFC.
 *
 * Não existe "NFC da mesa": existe uma TAG física, e a mesma mesa pode ter
 * várias (placa com QR + NFC, reserva, reposição). O status é da TAG.
 */
export type NfcStatus = "not_configured" | "configured" | "tested" | "disabled";

export const NFC_STATUS_LABEL: Record<NfcStatus, string> = {
  not_configured: "Não configurado",
  configured: "Configurado",
  tested: "Testado",
  disabled: "Desativado",
};

/** Estados em que a TAG tem uma URL gravada de fato. */
export const NFC_CONFIGURED_STATUSES: readonly NfcStatus[] = ["configured", "tested"];

export type NfcEventType =
  | "created"
  | "status_changed"
  | "identifier_changed"
  | "activated"
  | "deactivated"
  | "replaced"
  | "url_rotated";

export const NFC_EVENT_LABEL: Record<NfcEventType, string> = {
  created: "TAG cadastrada",
  status_changed: "Status alterado",
  identifier_changed: "Identificador alterado",
  activated: "TAG ativada",
  deactivated: "TAG desativada",
  replaced: "TAG substituída",
  url_rotated: "URL da mesa mudou — regravar a TAG",
};

/**
 * TAG + a URL pública calculada no banco.
 *
 * `nfc_url` é sempre a URL atual da mesa (`/r/{slug}/table/{token}`), a mesma
 * do QR Code. Nunca é uma cópia guardada: rotacionar o token ou mudar o slug
 * atualiza a URL sem migração.
 */
export type TableNfcTag = {
  tag_id: string;
  restaurant_id: string;
  table_id: string;
  label: string | null;
  tag_identifier: string | null;
  status: NfcStatus;
  is_active: boolean;
  /** A URL mudou depois desta gravação: a TAG precisa ser regravada. */
  is_stale: boolean;
  configured_at: string | null;
  tested_at: string | null;
  replaced_tag_id: string | null;
  created_at: string;
  updated_at: string;
  table_name: string;
  table_is_active: boolean;
  restaurant_slug: string;
  /** Caminho público (`/r/...`). A origem absoluta é montada na UI. */
  nfc_url: string;
  nfc_enabled: boolean;
  needs_rerecord: boolean;
};

export type NfcEvent = {
  id: string;
  event: NfcEventType;
  from_status: NfcStatus | null;
  to_status: NfcStatus | null;
  note: string | null;
  created_at: string;
  actor_id: string | null;
};

/* ==========================================================================
   Etapa 6 · Carrinho e pedidos
   ========================================================================== */

/**
 * Estados do pedido, na ordem em que a cozinha caminha.
 *
 * `cancelled` fica fora da sequência: pode acontecer em qualquer ponto.
 * O rótulo é o que o cliente lê na tela de sucesso e, na Etapa 7, no painel.
 */
export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  preparing: "Em preparo",
  ready: "Pronto",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

/** Texto de acompanhamento mostrado ao cliente, por status. */
export const ORDER_STATUS_HINT: Record<OrderStatus, string> = {
  pending: "Aguardando confirmação.",
  confirmed: "Pedido confirmado pela casa.",
  preparing: "Seu pedido está sendo preparado.",
  ready: "Pedido pronto — já vai para a mesa.",
  delivered: "Pedido entregue. Bom apetite!",
  cancelled: "Este pedido foi cancelado. Chame um atendente.",
};

/**
 * Canal do pedido. Só `dine_in` é usado nesta etapa: o resto é preparação
 * para delivery/retirada, e o banco já tem a coluna com default.
 */
export type OrderChannel = "dine_in" | "takeaway" | "delivery";

/**
 * Item do carrinho — estado local, nunca enviado com preço.
 *
 * Guardamos uma cópia de nome/preço apenas para exibir enquanto o cliente
 * navega. Ao enviar, vão somente `product_id` e `quantity`: o servidor relê
 * o preço atual e recalcula o total (item 11 do escopo).
 */
export type CartItem = {
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
};

/** Item de um pedido já gravado, como o banco devolve. */
export type OrderItem = {
  product_id: string | null;
  /** Nome no momento do pedido: mudar o produto depois não reescreve isto. */
  name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
  notes: string | null;
};

/** Pedido lido por `get_table_order` (tela de sucesso). */
export type TableOrder = {
  order_id: string;
  order_number: number;
  table_name: string;
  status: OrderStatus;
  subtotal: number;
  fees: number;
  discount: number;
  total: number;
  notes: string | null;
  created_at: string;
  items: OrderItem[];
};

/** Retorno de `create_order`. */
export type CreatedOrder = {
  order_id: string;
  order_number: number;
  table_name: string;
  restaurant_id: string;
  subtotal: number;
  total: number;
  status: OrderStatus;
  created_at: string;
};

/* ==========================================================================
   Etapa 7 · Painel de pedidos
   ========================================================================== */

/**
 * Pedido como o painel da equipe enxerga.
 *
 * Vem de `restaurant_orders` (view com itens embutidos) via
 * `list_restaurant_orders`. `item_count` é a soma das unidades, não o número
 * de linhas: "3 itens" precisa casar com o que o cliente viu no carrinho.
 */
export type PanelOrder = {
  id: string;
  restaurant_id: string;
  table_id: string;
  table_name: string;
  order_number: number;
  status: OrderStatus;
  channel: OrderChannel;
  subtotal: number;
  fees: number;
  discount: number;
  total: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  item_count: number;
};

/** Registro do histórico de status (append-only, escrito por trigger). */
export type OrderStatusEvent = {
  id: string;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  note: string | null;
  actor_id: string | null;
  created_at: string;
};

/** Abas do painel: cada uma é um recorte de status. */
export type PanelTab = "new" | "preparing" | "ready" | "done";

export const PANEL_TABS: Array<{
  id: PanelTab;
  label: string;
  statuses: OrderStatus[];
  /** Rótulo curto usado no card ("NOVO PEDIDO"). */
  badge: string;
}> = [
  { id: "new", label: "Novos", statuses: ["pending"], badge: "Novo pedido" },
  {
    id: "preparing",
    label: "Em preparo",
    statuses: ["confirmed", "preparing"],
    badge: "Em preparo",
  },
  { id: "ready", label: "Prontos", statuses: ["ready"], badge: "Pronto" },
  {
    id: "done",
    label: "Finalizados",
    statuses: ["delivered", "cancelled"],
    badge: "Finalizado",
  },
];

/** Rótulo do status como o painel fala: "NOVO PEDIDO", "EM PREPARO"... */
export const ORDER_STATUS_BOARD_LABEL: Record<OrderStatus, string> = {
  pending: "Novo pedido",
  confirmed: "Confirmado",
  preparing: "Em preparo",
  ready: "Pronto",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

/**
 * Próxima ação de cada status, na ordem do fluxo.
 *
 * Pedido num status que já não pede ação (entregue/cancelado) não aparece:
 * o painel não inventa botão.
 */
export const ORDER_NEXT_ACTION: Partial<
  Record<OrderStatus, { status: OrderStatus; label: string }>
> = {
  pending: { status: "confirmed", label: "Confirmar pedido" },
  confirmed: { status: "preparing", label: "Iniciar preparo" },
  preparing: { status: "ready", label: "Marcar como pronto" },
  ready: { status: "delivered", label: "Marcar como entregue" },
};

/** Status em que ainda faz sentido cancelar. */
export const ORDER_CANCELLABLE: readonly OrderStatus[] = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
];
