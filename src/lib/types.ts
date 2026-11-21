/** Tipos de domínio da Etapa 1. Espelham o schema em supabase/migrations. */

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
  /**
   * Plano e assinatura (Etapa 10). Modelo pronto, cobrança na Etapa 11: por
   * isso `subscription_status` nasce `none` em toda casa que já existe.
   */
  plan_id?: string | null;
  subscription_status?: SubscriptionStatus;
  subscription_start?: string | null;
  subscription_end?: string | null;
  /** Preenchidos só quando a plataforma suspende. */
  suspended_at?: string | null;
  suspended_reason?: string | null;
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

/* ==========================================================================
   Etapa 8 · Chamar garçom e pedir a conta
   ========================================================================== */

/**
 * Natureza da solicitação da mesa.
 *
 * `waiter` é "alguém venha aqui"; `bill` é "quero fechar a conta". São coisas
 * diferentes para o salão: a segunda normalmente envolve levar a maquininha.
 */
export type TableRequestType = "waiter" | "bill";

export type TableRequestStatus = "pending" | "acknowledged" | "resolved" | "cancelled";

export const TABLE_REQUEST_TYPE_LABEL: Record<TableRequestType, string> = {
  waiter: "Chamar garçom",
  bill: "Solicitou conta",
};

/** Rótulo curto para o card do painel ("GARÇOM" / "CONTA"). */
export const TABLE_REQUEST_TYPE_BADGE: Record<TableRequestType, string> = {
  waiter: "Garçom",
  bill: "Conta",
};

export const TABLE_REQUEST_STATUS_LABEL: Record<TableRequestStatus, string> = {
  pending: "Pendente",
  acknowledged: "Atendendo",
  resolved: "Resolvida",
  cancelled: "Cancelada",
};

/** Solicitação como o painel da equipe recebe. */
export type TableRequest = {
  id: string;
  restaurant_id: string;
  table_id: string;
  table_name: string;
  type: TableRequestType;
  status: TableRequestStatus;
  note: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
};

/** Situação da mesa agora, para a tela do cliente decidir o que mostrar. */
export type TableRequestState = {
  waiter_status: TableRequestStatus | null;
  waiter_since: string | null;
  bill_status: TableRequestStatus | null;
  bill_since: string | null;
  /** Fim do cooldown da última solicitação (qualquer tipo). */
  cooldown_until: string | null;
};

/** Resultado de `create_table_request` (cliente). */
export type CreatedTableRequest = {
  request_id: string;
  table_name: string;
  type: TableRequestType;
  status: TableRequestStatus;
  created_at: string;
};

/* ==========================================================================
   Etapa 9 · Personalização visual do cardápio
   ========================================================================== */

export type CardStyle = "rounded" | "soft" | "flat";
export type ButtonStyle = "solid" | "outline" | "pill";

export type ThemePresetId =
  | "moderno"
  | "elegante"
  | "dark"
  | "minimalista"
  | "restaurante"
  | "fastfood";

/**
 * Tema do cardápio de um restaurante.
 *
 * Uma linha por restaurante (PK = restaurant_id), então é impossível existir
 * "tema de duas casas" ou tema órfão. Todos os campos de cor são hex `#rrggbb`
 * já normalizados — o banco tem `check` para isso.
 */
export type RestaurantTheme = {
  /** Último preset aplicado; `null` quando o dono nunca escolheu um. */
  preset: ThemePresetId | null;
  primary_color: string;
  secondary_color: string;
  background_color: string;
  text_color: string;
  button_color: string;
  card_style: CardStyle;
  button_style: ButtonStyle;
  logo_url: string | null;
  cover_url: string | null;
};

/** Tokens resolvidos (contraste já corrigido) usados para pintar a tela. */
export type ThemeTokens = {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textMuted: string;
  border: string;
  button: string;
  buttonText: string;
  buttonTextMuted: string;
  onPrimary: string;
  primarySoft: string;
  isDark: boolean;
  cardStyle: CardStyle;
  buttonStyle: ButtonStyle;
};

/** Imagem enviada pelo painel (logo ou capa). */
export type ThemeImageKind = "logo" | "cover";

export const THEME_IMAGE_LABEL: Record<ThemeImageKind, string> = {
  logo: "Logo",
  cover: "Capa",
};

/* ==========================================================================
   Etapa 10 · Painel master do administrador da plataforma
   ========================================================================== */

/**
 * Papel do usuário **dentro de um restaurante**.
 *
 * `manager` (Etapa 10) é o gerente: opera cardápio, mesas, pedidos e tema,
 * mas não gerencia a equipe — no banco isso é `is_restaurant_admin` para o
 * operacional e `is_restaurant_owner_admin` para a equipe.
 */
export type RestaurantRole = "owner" | "admin" | "manager" | "staff" | "kitchen" | "waiter";

export const RESTAURANT_ROLE_LABEL: Record<RestaurantRole, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  manager: "Gerente",
  staff: "Equipe",
  kitchen: "Cozinha",
  waiter: "Garçom",
};

/**
 * O que cada papel pode fazer **no painel**. Puramente descritivo: quem decide é
 * o banco (`is_restaurant_admin`, `kds_can_*`). A tela usa isto para esconder
 * botão que ia falhar — conveniência, nunca segurança.
 *
 * `kitchen` e `waiter` são os papéis da Etapa 17. O recorte deles é a razão de
 * existirem: quem cozinha não mexe em cardápio, e quem atende não decide quando
 * a comida saiu do fogo.
 */
export const ROLE_CAPABILITIES: Record<
  RestaurantRole,
  {
    /** Cardápio, mesas, tema, configurações do restaurante. */
    manageMenu: boolean;
    /** Ver e operar o painel de pedidos do salão. */
    manageOrders: boolean;
    /** Relatórios financeiros. */
    viewAnalytics: boolean;
    /** Equipe e papéis. */
    manageTeam: boolean;
    /** Abrir o KDS. */
    useKitchen: boolean;
  }
> = {
  owner: {
    manageMenu: true,
    manageOrders: true,
    viewAnalytics: true,
    manageTeam: true,
    useKitchen: true,
  },
  admin: {
    manageMenu: true,
    manageOrders: true,
    viewAnalytics: true,
    manageTeam: true,
    useKitchen: true,
  },
  manager: {
    manageMenu: true,
    manageOrders: true,
    viewAnalytics: true,
    manageTeam: false,
    useKitchen: true,
  },
  staff: {
    manageMenu: false,
    manageOrders: true,
    viewAnalytics: false,
    manageTeam: false,
    useKitchen: true,
  },
  kitchen: {
    manageMenu: false,
    // O painel do salão mostra valores, contas e cancelamento — nada disso é
    // assunto da cozinha. O lugar dela é `/kitchen`.
    manageOrders: false,
    viewAnalytics: false,
    manageTeam: false,
    useKitchen: true,
  },
  waiter: {
    manageMenu: false,
    manageOrders: true,
    viewAnalytics: false,
    manageTeam: false,
    useKitchen: true,
  },
};

/** Papéis que só enxergam a cozinha — a navegação deles é outra. */
export const KITCHEN_ONLY_ROLES: RestaurantRole[] = ["kitchen"];

/** Papel de quem enxerga a plataforma inteira (tabela `platform_admins`). */
export type PlatformRole = "owner" | "admin";

export const PLATFORM_ROLE_LABEL: Record<PlatformRole, string> = {
  owner: "Dono da plataforma",
  admin: "Administrador da plataforma",
};

/**
 * Status do restaurante, do ponto de vista de quem opera.
 *
 * Note a diferença de dono do dado:
 *   - `draft`, `published`, `paused`, `closed` → o **restaurante** decide;
 *   - `suspended`                        → só a **plataforma** decide.
 *
 * Por isso o trigger `guard_restaurant_admin_fields` recusa `suspended` vindo
 * de quem não é admin global, inclusive na saída da suspensão.
 */
export type RestaurantStatus = "draft" | "published" | "paused" | "closed" | "suspended";

export const RESTAURANT_STATUS_LABEL: Record<RestaurantStatus, string> = {
  draft: "Rascunho",
  published: "Ativo",
  paused: "Pausado",
  closed: "Fechado",
  suspended: "Suspenso",
};

/** Como cada status aparece no painel master. */
export type AdminStatusTone = "success" | "warning" | "neutral" | "danger";

export const RESTAURANT_STATUS_TONE: Record<RestaurantStatus, AdminStatusTone> = {
  published: "success",
  draft: "warning",
  paused: "neutral",
  closed: "neutral",
  suspended: "danger",
};

/** Rótulos do filtro de status do painel (item 3 e 6 do escopo). */
export const ADMIN_STATUS_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "published", label: "Ativos" },
  { id: "paused", label: "Inativos" },
  { id: "suspended", label: "Suspensos" },
  { id: "draft", label: "Rascunhos" },
] as const;

export type AdminStatusFilter = (typeof ADMIN_STATUS_FILTERS)[number]["id"];

/** Contadores globais do dashboard (`admin_dashboard`). */
export type AdminDashboard = {
  restaurants_total: number;
  restaurants_active: number;
  restaurants_inactive: number;
  restaurants_suspended: number;
  products_total: number;
  tables_total: number;
  orders_total: number;
  orders_today: number;
  users_total: number;
};

/**
 * Linha da lista de restaurantes.
 *
 * O responsável (`owner_*`) vem do primeiro owner ativo: casas sem owner, que
 * só existem após exclusão de conta, aparecem com `null` em vez de sumirem da
 * lista — o suporte precisa vê-las justamente para corrigir isso.
 */
export type AdminRestaurantRow = {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  phone: string | null;
  created_at: string;
  products_count: number;
  tables_count: number;
  members_count: number;
  orders_count: number;
  owner_name: string | null;
  owner_email: string | null;
  plan_id: string | null;
  subscription_status: SubscriptionStatus;
  suspended_reason: string | null;
};

/** Status de assinatura — modelo pronto, cobrança na Etapa 11. */
export type SubscriptionStatus = "none" | "trialing" | "active" | "past_due" | "canceled";

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  none: "Sem assinatura",
  trialing: "Em teste",
  active: "Ativa",
  past_due: "Pagamento atrasado",
  canceled: "Cancelada",
};

export type Plan = {
  id: string;
  name: string;
  description: string | null;
  price_monthly: number;
  features: string[];
  is_active: boolean;
  position: number;
};

export type AdminRestaurantMember = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: RestaurantRole;
  status: MemberStatus;
  created_at: string;
};

export type AdminRestaurantProduct = {
  id: string;
  name: string;
  price: number;
  is_available: boolean;
  category_name: string | null;
};

export type AdminRestaurantCategory = {
  id: string;
  name: string;
  is_active: boolean;
  products_count: number;
};

export type AdminRestaurantTable = {
  id: string;
  name: string;
  is_active: boolean;
  public_token: string;
};

export type AdminRestaurantOrder = {
  id: string;
  order_number: number;
  status: OrderStatus;
  total: number;
  created_at: string;
  table_name: string | null;
};

/** Detalhe de suporte (`admin_restaurant_detail`) — sete blocos de uma vez. */
export type AdminRestaurantDetail = {
  restaurant: Restaurant;
  counts: {
    products: number;
    categories: number;
    tables: number;
    orders: number;
    orders_today: number;
    members: number;
  };
  members: AdminRestaurantMember[];
  products: AdminRestaurantProduct[];
  categories: AdminRestaurantCategory[];
  tables: AdminRestaurantTable[];
  orders: AdminRestaurantOrder[];
  theme: (Omit<RestaurantTheme, "preset"> & { preset: ThemePresetId | null; updated_at: string }) | null;
};

/** Linha de `admin_list_users`. Um usuário pode ter vários restaurantes. */
export type AdminUserRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  is_platform_admin: boolean;
  platform_role: PlatformRole | null;
  restaurants: Array<{
    restaurant_id: string;
    name: string;
    slug: string;
    role: RestaurantRole;
    status: MemberStatus;
  }>;
};

export type AdminOrderRow = {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  table_name: string | null;
  order_number: number;
  status: OrderStatus;
  total: number;
  created_at: string;
};

/** Evento de auditoria administrativa. */
export type AdminAuditRow = {
  id: string;
  actor_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

/* ==========================================================================
   Etapa 11 · Planos e assinaturas
   ========================================================================== */

/**
 * Ciclo de vida comercial da casa (enum `subscription_state`).
 *
 * Diferente de `SubscriptionStatus` (Etapa 10): ali os valores espelhavam um
 * texto livre; aqui são os seis estados do escopo, com `trial` distinto de
 * `active` — o trial tem prazo e o acesso cai sozinho.
 */
export type SubscriptionState =
  | "trial"
  | "active"
  | "past_due"
  | "cancelled"
  | "expired"
  | "suspended";

export const SUBSCRIPTION_STATE_LABEL: Record<SubscriptionState, string> = {
  trial: "Em teste",
  active: "Ativa",
  past_due: "Pagamento atrasado",
  cancelled: "Cancelada",
  expired: "Expirada",
  suspended: "Suspensa",
};

export const SUBSCRIPTION_STATE_TONE: Record<
  SubscriptionState,
  "success" | "warning" | "info" | "danger" | "neutral"
> = {
  trial: "info",
  active: "success",
  past_due: "warning",
  cancelled: "neutral",
  expired: "danger",
  suspended: "danger",
};

/** Estados em que o painel do restaurante continua liberado. */
export const SUBSCRIPTION_STATE_ALLOWS_ACCESS: Record<SubscriptionState, boolean> = {
  trial: true,
  active: true,
  past_due: true,
  cancelled: false,
  expired: false,
  suspended: false,
};

export type BillingInterval = "monthly" | "yearly";

export const BILLING_INTERVAL_LABEL: Record<BillingInterval, string> = {
  monthly: "por mês",
  yearly: "por ano",
};

/**
 * Chaves de limite — a lista canônica compartilhada por banco, UI e testes.
 *
 * A ordem aqui é a ordem em que os limites aparecem na tela "Meu plano".
 * Nenhum número mora neste arquivo: só os nomes das chaves.
 */
export const PLAN_LIMIT_KEYS = [
  "max_products",
  "max_tables",
  "max_users",
  "max_categories",
  "max_orders_month",
] as const;

export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

export const PLAN_LIMIT_LABEL: Record<PlanLimitKey, string> = {
  max_products: "Produtos",
  max_tables: "Mesas",
  max_users: "Usuários",
  max_categories: "Categorias",
  max_orders_month: "Pedidos por mês",
};

/** Frase usada no erro quando o limite estoura (item 8 do escopo). */
export const PLAN_LIMIT_MESSAGE: Record<PlanLimitKey, string> = {
  max_products: "Seu plano atingiu o limite de produtos.",
  max_tables: "Seu plano atingiu o limite de mesas.",
  max_users: "Seu plano atingiu o limite de usuários.",
  max_categories: "Seu plano atingiu o limite de categorias.",
  max_orders_month: "Seu plano atingiu o limite de pedidos no mês.",
};

/**
 * Chaves de recurso (`plans.features`).
 *
 * `null` de propósito para recurso que ainda não tem tela: a chave existe no
 * banco e no plano, mas o app não a consome — é o caso de `custom_domain`. A
 * vitrine mostra o rótulo; o bloqueio acontece quando a feature for usada.
 */
export const PLAN_FEATURE_KEYS = [
  "custom_theme",
  "nfc",
  "qr_code",
  "waiter_call",
  "bill_request",
  "analytics",
  "custom_domain",
  "whatsapp",
  "pix",
] as const;

export type PlanFeatureKey = (typeof PLAN_FEATURE_KEYS)[number];

export const PLAN_FEATURE_LABEL: Record<PlanFeatureKey, string> = {
  custom_theme: "Personalização visual",
  nfc: "Etiquetas NFC",
  qr_code: "QR Code das mesas",
  waiter_call: "Chamar garçom",
  bill_request: "Pedir a conta",
  analytics: "Relatórios",
  custom_domain: "Domínio próprio",
  whatsapp: "WhatsApp",
  pix: "Pix",
};

export const isPlanFeatureKey = (value: string): value is PlanFeatureKey =>
  (PLAN_FEATURE_KEYS as readonly string[]).includes(value);

export const isPlanLimitKey = (value: string): value is PlanLimitKey =>
  (PLAN_LIMIT_KEYS as readonly string[]).includes(value);

/** Plano do catálogo, como a vitrine e o editor do admin consomem. */
export type PlanLimits = Partial<Record<PlanLimitKey, number | null>>;

export type PlanCatalogEntry = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  interval: BillingInterval;
  features: string[];
  limits: PlanLimits;
};

/** Filtra o que o banco mandou para as chaves conhecidas (nada de `any`). */
export function normalizePlanFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function normalizePlanLimits(value: unknown): PlanLimits {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: PlanLimits = {};
  for (const key of PLAN_LIMIT_KEYS) {
    if (!(key in source)) continue;
    const raw = source[key];
    result[key] = raw === null || raw === undefined ? null : Number(raw);
  }
  return result;
}

/** Uso vs. limite de um recurso contável. */
export type UsageCounter = { used: number; limit: number | null };

export type RestaurantUsage = {
  plan_id: string;
  plan_name: string;
  limits: PlanLimits;
  features: string[];
  products: UsageCounter;
  tables: UsageCounter;
  users: UsageCounter;
  categories: UsageCounter;
  orders_month: UsageCounter;
};

/** Resultado de `check_plan_limit`. */
export type PlanLimitCheck = {
  key: PlanLimitKey;
  plan_id: string;
  used: number;
  limit: number | null;
  allowed: boolean;
};

/** Assinatura corrente vista pelo dono (`my_subscription`). */
export type MySubscription = {
  restaurant_id: string;
  status: SubscriptionState;
  has_subscription: boolean;
  plan: PlanCatalogEntry;
  period_start: string | null;
  period_end: string | null;
  trial_start: string | null;
  trial_end: string | null;
  cancelled_at: string | null;
  price_snapshot: number;
  trial_days: number;
  usage: RestaurantUsage;
};

/** Linha de `subscriptions` quando o admin precisa do registro cru. */
export type SubscriptionRecord = {
  id: string;
  restaurant_id: string;
  plan_id: string;
  status: SubscriptionState;
  billing_interval: BillingInterval;
  current_period_start: string;
  current_period_end: string | null;
  trial_start: string | null;
  trial_end: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  provider: string | null;
  external_customer_id: string | null;
  external_subscription_id: string | null;
  price_snapshot: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** Plano na visão do painel master (inclui inativos). */
export type AdminPlanRow = PlanCatalogEntry & {
  is_active: boolean;
  position: number;
  created_at: string;
  updated_at: string | null;
};

/** Linha de `/admin/assinaturas`. */
export type AdminSubscriptionRow = {
  restaurant_id: string;
  restaurant_name: string;
  restaurant_slug: string;
  plan_id: string;
  plan_name: string;
  price: number;
  status: SubscriptionState;
  billing_interval: BillingInterval;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_start: string | null;
  trial_end: string | null;
  days_left: number | null;
  cancelled_at: string | null;
  provider: string | null;
  external_subscription_id: string | null;
  subscription_id: string | null;
};

/** Contadores comerciais de `/admin/planos`. */
export type BillingSummary = {
  plans_total: number;
  plans_active: number;
  subscriptions_total: number;
  trials: number;
  active: number;
  past_due: number;
  cancelled: number;
  expired: number;
  mrr: number;
  trial_days: number;
  grace_days: number;
};

/** Vitrine pública de `/planos`. */
export type PublicPlansPayload = {
  trial_days: number;
  plans: PlanCatalogEntry[];
};

/* -------------------------------------------------------------------------- */
/* Analytics — Etapa 16                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Preset de período.
 *
 * A lista é fechada de propósito: o valor vai para `analytics_period`, que
 * levanta `unknown_preset` em qualquer coisa fora dela. Um `?periodo=` na URL
 * não vira SQL — vira uma `case` no banco.
 */
export type AnalyticsPeriod =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "this_month"
  | "last_month"
  | "custom";

/** Rótulo do filtro rápido. Ordem = ordem dos chips na tela. */
export const ANALYTICS_PERIODS: Array<{ id: AnalyticsPeriod; label: string; short: string }> = [
  { id: "today", label: "Hoje", short: "Hoje" },
  { id: "yesterday", label: "Ontem", short: "Ontem" },
  { id: "last7", label: "Últimos 7 dias", short: "7 dias" },
  { id: "last30", label: "Últimos 30 dias", short: "30 dias" },
  { id: "this_month", label: "Este mês", short: "Este mês" },
  { id: "last_month", label: "Mês anterior", short: "Mês passado" },
  { id: "custom", label: "Personalizado", short: "Escolher" },
];

/** `true` quando o preset exige `from`/`to` na querystring. */
export const ANALYTICS_NEEDS_DATES = (period: AnalyticsPeriod): boolean => period === "custom";

/** Métodos de pagamento como o salão fala. */
export type PaymentMethod = "cash" | "pix" | "card" | "other";

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Dinheiro",
  pix: "Pix",
  card: "Cartão",
  other: "Outro",
};

export type PaymentStatus = "paid" | "refunded";

/** Um lançamento no livro de pagamentos. */
export type OrderPayment = {
  payment_id: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  paid_at: string;
  note: string | null;
};

/**
 * Resumo do período.
 *
 * `orders_value` é o que foi **pedido**; `paid_value` é o que **entrou**.
 * Os dois convivem de propósito e não devem ser somados nem trocados: um
 * pedido entregue e ainda não pago aparece em `orders_value` e em
 * `unpaid_value`, e em `paid_value` somente quando alguém registrar o
 * recebimento.
 */
export type AnalyticsSummary = {
  preset: AnalyticsPeriod;
  from_date: string;
  to_date: string;
  orders_count: number;
  orders_value: number;
  paid_value: number;
  unpaid_value: number;
  orders_cancelled: number;
  cancelled_value: number;
  ticket_average: number;
  waiter_calls: number;
  bill_requests: number;
  items_sold: number;
  orders_by_status: Partial<Record<OrderStatus, number>>;
};

/** Um ponto do gráfico de vendas/pedidos por dia. */
export type AnalyticsDay = {
  day: string;
  orders_count: number;
  orders_value: number;
  paid_value: number;
  cancelled_count: number;
};

/** Hora do dia (0–23) sempre presente, mesmo com zero pedidos. */
export type AnalyticsHour = { hour: number; orders_count: number; orders_value: number };

export type AnalyticsProduct = { product_name: string; quantity: number; revenue: number };

export type AnalyticsCategory = {
  category_id: string | null;
  category_name: string;
  quantity: number;
  revenue: number;
};

export type AnalyticsTable = {
  table_id: string;
  table_name: string;
  orders_count: number;
  orders_value: number;
};

export type AnalyticsPaymentMethod = {
  method: PaymentMethod;
  payments_count: number;
  amount: number;
};

/** Mesmo tamanho do período atual, imediatamente antes dele. */
export type AnalyticsPrevious = {
  from_date: string;
  to_date: string;
  orders_count: number;
  orders_value: number;
  paid_value: number;
  ticket_average: number;
  /** `false` quando não houve pedido: crescer a partir de zero não tem %. */
  has_data: boolean;
};

/** Tudo o que a tela de analytics consome, numa chamada. */
export type AnalyticsPayload = {
  summary: AnalyticsSummary;
  previous: AnalyticsPrevious;
  daily: AnalyticsDay[];
  hours: AnalyticsHour[];
  products: AnalyticsProduct[];
  categories: AnalyticsCategory[];
  tables: AnalyticsTable[];
  methods: AnalyticsPaymentMethod[];
  timeZone: string;
};

/** Métricas globais da plataforma (`/admin/analytics`). */
export type AdminAnalytics = {
  days: number;
  restaurants_total: number;
  restaurants_active: number;
  restaurants_suspended: number;
  restaurants_new: number;
  restaurants_previous: number;
  orders_total: number;
  orders_value: number;
  paid_value: number;
  orders_cancelled: number;
  orders_new: number;
  orders_previous: number;
  active_subscriptions: number;
  trials_now: number;
  mrr: number;
};

export type AdminAnalyticsDay = {
  day: string;
  restaurants_new: number;
  orders_count: number;
  orders_value: number;
};

/**
 * Resultado de registrar/estornar pagamento.
 *
 * Mesmo formato das outras actions de pedido (`{ok:true}` / `{ok:false,error}`),
 * para o componente tratar erro do banco sem inventar caminho novo.
 */
export type PaymentActionResult =
  | { ok: true; payment: OrderPayment }
  | { ok: false; error: string };

/* ==========================================================================
   Etapa 17 · Painel de cozinha (KDS)
   ========================================================================== */

/** As quatro colunas do KDS, na ordem em que a cozinha trabalha. */
export type KitchenColumn = "new" | "preparing" | "ready" | "done";

export const KITCHEN_COLUMNS: Array<{ id: KitchenColumn; label: string; hint: string }> = [
  { id: "new", label: "Novos", hint: "Chegaram e ainda não entraram no fogo" },
  { id: "preparing", label: "Em preparo", hint: "A cozinha está fazendo" },
  { id: "ready", label: "Prontos", hint: "Esperando alguém levar à mesa" },
  { id: "done", label: "Finalizados", hint: "Entregues ou cancelados" },
];

/**
 * Mapeamento status → coluna.
 *
 * `pending` e `confirmed` caem juntos em "Novos" porque a diferença entre eles
 * é se alguém da casa já *viu* o pedido, não se ele entrou na produção. Para a
 * cozinha são os dois o mesmo estado: "ainda não comecei".
 */
export const KITCHEN_COLUMN_OF: Record<OrderStatus, KitchenColumn> = {
  pending: "new",
  confirmed: "new",
  preparing: "preparing",
  ready: "ready",
  delivered: "done",
  cancelled: "done",
};

/** Nível de urgência derivado do tempo, nunca de cor sozinha. */
export type KitchenUrgency = "ok" | "warn" | "late";

export const KITCHEN_URGENCY_LABEL: Record<KitchenUrgency, string> = {
  ok: "No prazo",
  warn: "Atenção",
  late: "Atrasado",
};

/** Adicional escolhido no item (estrutura pronta; ver comentário na migration). */
export type OrderItemOption = {
  group_name: string;
  name: string;
  price_delta: number;
  quantity: number;
};

/** Item como o KDS desenha: com observação, adicionais e estação. */
export type KitchenOrderItem = {
  id: string;
  product_id: string | null;
  name: string;
  quantity: number;
  subtotal: number;
  notes: string | null;
  category_id: string | null;
  station_slug: string | null;
  options: OrderItemOption[];
};

/** Pedido na tela da cozinha. */
export type KitchenOrder = {
  id: string;
  restaurant_id: string;
  table_id: string;
  table_name: string;
  order_number: number;
  status: OrderStatus;
  channel: OrderChannel;
  total: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Primeiro instante em que o pedido entrou em preparo (do histórico). */
  preparing_since: string | null;
  items: KitchenOrderItem[];
  item_count: number;
};

export type KitchenStation = {
  id: string;
  name: string;
  slug: string;
  kind: "prep" | "expedition";
  sort_order: number;
};

export type KitchenSettings = {
  late_after_minutes: number;
  warn_after_minutes: number;
};

/** Filtros do KDS. `station` vazio = todas.
 *
 * `late` e `recent` não são recortes de status: são recortes de TEMPO, e por
 * isso são aplicados depois do cálculo de urgência, no cliente — o servidor não
 * precisa saber que horas são no fuso da casa.
 */
export type KitchenFilter = {
  tableId: string | null;
  station: string | null;
  lateOnly: boolean;
  recentOnly: boolean;
};

/** Uma ação do card, já com o status de destino. */
export type KitchenAction = "accept" | "start" | "ready" | "finish" | "cancel";

export const KITCHEN_ACTION_TARGET: Record<KitchenAction, OrderStatus> = {
  accept: "confirmed",
  start: "preparing",
  ready: "ready",
  finish: "delivered",
  cancel: "cancelled",
};

/** Rótulo do botão. O escopo pede estas cinco palavras. */
export const KITCHEN_ACTION_LABEL: Record<KitchenAction, string> = {
  accept: "Aceitar",
  start: "Iniciar preparo",
  ready: "Pronto",
  finish: "Finalizar",
  cancel: "Cancelar",
};

/* ==========================================================================
   Etapa 18 · Impressão de pedidos
   ========================================================================== */

/** Largura do rolo. Os dois padrões de mercado para térmica de balcão. */
export type PaperWidth = "58" | "80";

/**
 * Natureza do perfil de impressão.
 *
 * Hoje é rótulo: o perfil diz *para onde* um pedido vai quando alguém imprime.
 * A divisão automática por tipo de item (bebida → bar) é evolução futura, e é
 * para isso que o campo já existe.
 */
export type PrintProfileKind = "kitchen" | "counter" | "bar" | "cashier";

export const PRINT_PROFILE_KIND_LABEL: Record<PrintProfileKind, string> = {
  kitchen: "Cozinha",
  counter: "Balcão",
  bar: "Bar",
  cashier: "Caixa",
};

/**
 * Como a impressão é executada.
 *
 * `browser` é o único que existe hoje, e ele **não** conversa com a térmica:
 * abre a caixa de diálogo do sistema e depende do driver instalado. Os demais
 * estão declarados para que a tela possa dizer a verdade — "precisa de bridge
 * local" — em vez de fingir funcionar.
 */
export type PrintProviderKind = "browser" | "os" | "web_print" | "bridge" | "service";

export const PRINT_PROVIDER_LABEL: Record<PrintProviderKind, string> = {
  browser: "Navegador",
  os: "Sistema operacional",
  web_print: "Web Print",
  bridge: "Bridge local",
  service: "Serviço de impressão",
};

/** O que cada provedor consegue hoje. Curto de propósito: é o que a tela diz. */
export type PrintProviderSupport = "available" | "planned";

export const PRINT_PROVIDER_SUPPORT: Record<PrintProviderKind, PrintProviderSupport> = {
  browser: "available",
  os: "planned",
  web_print: "planned",
  bridge: "planned",
  service: "planned",
};

/** Texto honesto sobre o que cada provedor exige. Sem promessa vaga. */
export const PRINT_PROVIDER_HINT: Record<PrintProviderKind, string> = {
  browser:
    "Abre a caixa de diálogo do navegador. A impressora precisa estar instalada no aparelho; a térmica é escolhida na janela do sistema.",
  os: "Depende de um serviço local que fale com a fila de impressão do sistema.",
  web_print:
    "Depende de um servidor Web Print/CUPS na mesma rede da impressora.",
  bridge:
    "Depende de um aplicativo instalado no computador da loja, ligado à térmica por USB ou rede.",
  service:
    "Depende de um serviço de impressão em nuvem contratado à parte.",
};

/** Modo de operação configurado pela casa. */
export type PrintMode = "manual" | "auto";

export const PRINT_MODE_LABEL: Record<PrintMode, string> = {
  manual: "Manual",
  auto: "Automática",
};

export type PrintJobStatus = "requested" | "printed" | "failed" | "unsupported";

export const PRINT_JOB_STATUS_LABEL: Record<PrintJobStatus, string> = {
  requested: "Solicitada",
  printed: "Confirmada pelo provedor",
  failed: "Falhou",
  unsupported: "Provedor não disponível",
};

/** Configuração da casa. Mesmos nomes da tabela, sem `restaurant_id`. */
export type PrintSettings = {
  mode: PrintMode;
  default_paper_width: PaperWidth;
  print_orders: boolean;
  print_tickets: boolean;
  print_kitchen: boolean;
  print_counter: boolean;
  copies: number;
  footer_note: string | null;
};

export type PrintProfile = {
  id: string;
  name: string;
  slug: string;
  kind: PrintProfileKind;
  paper_width: PaperWidth;
  copies: number;
  is_active: boolean;
  sort_order: number;
};

export type Printer = {
  id: string;
  profile_id: string | null;
  name: string;
  provider: PrintProviderKind;
  identifier: string | null;
  paper_width: PaperWidth;
  is_default: boolean;
  is_active: boolean;
  notes: string | null;
};

/** Tudo o que a tela de configuração consome numa chamada. */
export type PrintConfig = {
  settings: PrintSettings;
  profiles: PrintProfile[];
  printers: Printer[];
  can_configure: boolean;
};

/**
 * Pedido montado para o papel.
 *
 * `payments` só traz pagamento **real** (livro da Etapa 16). Vazio significa
 * "ninguém registrou recebimento" — e o layout então omite a linha. Escrever
 * "NÃO PAGO" no papel seria afirmar algo que o app não sabe.
 */
export type PrintOrderDocument = {
  restaurant: {
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    city: string | null;
    timezone: string;
  };
  settings: {
    mode: PrintMode;
    default_paper_width: PaperWidth;
    copies: number;
    footer_note: string | null;
    show_prices: boolean;
  };
  order: {
    id: string;
    order_number: number;
    status: OrderStatus;
    channel: OrderChannel;
    table_name: string;
    subtotal: number;
    fees: number;
    discount: number;
    total: number;
    notes: string | null;
    created_at: string;
    updated_at: string;
    items: Array<{
      name: string;
      quantity: number;
      unit_price: number;
      subtotal: number;
      notes: string | null;
      options: Array<{
        group_name: string;
        name: string;
        price_delta: number;
        quantity: number;
      }>;
    }>;
    payments: Array<{
      method: PaymentMethod;
      amount: number;
      paid_at: string;
    }>;
  };
};
