import {
  KITCHEN_COLUMN_OF,
  KITCHEN_ACTION_TARGET,
  type KitchenAction,
  type KitchenColumn,
  type KitchenOrder,
  type KitchenUrgency,
  type OrderStatus,
} from "@/lib/types";

/**
 * Regras puras do painel de cozinha.
 *
 * Tudo aqui é função de entrada → saída, sem React, sem banco e sem relógio
 * global (o "agora" entra como argumento). São exatamente as regras que erram
 * em produção de forma silenciosa: contador que reinicia, pedido que aparece na
 * coluna errada, botão oferecido numa transição inválida. Testar isso com DOM
 * seria testar a embalagem; aqui dá para provar a regra.
 */

/* -------------------------------------------------------------------------- */
/* Tempo                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Minutos decorridos desde um instante ISO.
 *
 * Nunca devolve negativo. Relógio de tablet desregulado é comum (fuso, syncing
 * com NTP, usuário ajusta a hora na mão); um `-3 min` na tela faria a cozinha
 * desconfiar do painel inteiro, e um contador negativo é pior que um zero.
 */
export function elapsedMinutes(fromIso: string, nowMs: number): number {
  const from = new Date(fromIso).getTime();
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.floor((nowMs - from) / 60_000));
}

/**
 * Contador `MM:SS` a partir dos segundos totais.
 *
 * Passando de 99 minutos o formato ganha horas (`1h05`) em vez de estourar a
 * largura do card com `125:30`. A cozinha não lê "125 minutos"; lê "2h".
 */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Segundos desde a entrada do pedido — base do contador ao vivo. */
export function secondsSince(order: Pick<KitchenOrder, "created_at">, nowMs: number): number {
  const from = new Date(order.created_at).getTime();
  if (!Number.isFinite(from)) return 0;
  return Math.max(0, Math.floor((nowMs - from) / 1000));
}

/**
 * Há quanto tempo está em preparo.
 *
 * Devolve `null` quando o pedido ainda não começou — e é importante que seja
 * `null`, não `0`: "em preparo há 0 min" e "nem começou" são coisas diferentes,
 * e o card mostra textos diferentes.
 *
 * A fonte é `preparing_since`, que vem do primeiro evento `→ preparing` no
 * histórico. Usar `updated_at` seria o erro clássico: ele muda a cada toque e o
 * contador reiniciaria toda vez que alguém mexesse no pedido.
 */
export function orderPreparationMinutes(
  order: Pick<KitchenOrder, "preparing_since">,
  nowMs: number,
): number | null {
  if (!order.preparing_since) return null;
  return elapsedMinutes(order.preparing_since, nowMs);
}

/**
 * Urgência do pedido.
 *
 * `warn` e `late` saem dos limites configurados por restaurante. Pedido já
 * finalizado nunca é urgente: um "atrasado" em pedido entregue é ruído que
 * treina a equipe a ignorar o vermelho.
 *
 * O relógio usado é SEMPRE a entrada do pedido, não o início do preparo. Na
 * prática é o que a cozinha sente: o cliente está esperando desde que pediu,
 * não desde que a cozinha começou.
 */
export function orderUrgency(
  order: Pick<KitchenOrder, "created_at" | "status">,
  nowMs: number,
  settings: { late_after_minutes: number; warn_after_minutes: number },
): KitchenUrgency {
  if (order.status === "delivered" || order.status === "cancelled") return "ok";

  const minutes = elapsedMinutes(order.created_at, nowMs);
  if (minutes >= settings.late_after_minutes) return "late";
  if (minutes >= settings.warn_after_minutes) return "warn";
  return "ok";
}

/* -------------------------------------------------------------------------- */
/* Colunas                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Separa os pedidos nas quatro colunas.
 *
 * A ordem dentro de cada coluna é por `created_at` **crescente**: o pedido mais
 * antigo fica no topo. É o contrário de um feed — na cozinha, quem espera há
 * mais tempo é quem precisa de atenção primeiro.
 *
 * Finalizados vão em ordem decrescente, porque ali o que interessa é o que
 * acabou de sair (para conferir a entrega), não o mais antigo do turno.
 */
export function groupByColumn(orders: KitchenOrder[]): Record<KitchenColumn, KitchenOrder[]> {
  const groups: Record<KitchenColumn, KitchenOrder[]> = {
    new: [],
    preparing: [],
    ready: [],
    done: [],
  };

  for (const order of orders) {
    groups[KITCHEN_COLUMN_OF[order.status]].push(order);
  }

  const ascending = (a: KitchenOrder, b: KitchenOrder) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime();

  groups.new.sort(ascending);
  groups.preparing.sort(ascending);
  groups.ready.sort(ascending);
  groups.done.sort((a, b) => -ascending(a, b));

  return groups;
}

/* -------------------------------------------------------------------------- */
/* Ações                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Botões que fazem sentido para o status atual.
 *
 * A tabela de transições do banco (`order_next_statuses`) é a verdade; isto é a
 * mesma regra no cliente, para o card não oferecer botão que vai falhar. Se as
 * duas divergirem, o banco ganha e a tela mostra o erro — o que é o desenho
 * correto: conveniência local, decisão remota.
 */
export function availableActions(status: OrderStatus): KitchenAction[] {
  switch (status) {
    case "pending":
      return ["accept", "cancel"];
    case "confirmed":
      return ["start", "cancel"];
    case "preparing":
      return ["ready", "cancel"];
    case "ready":
      return ["finish", "cancel"];
    default:
      return [];
  }
}

/**
 * Saúde dos botões para um papel.
 *
 * A cozinha não cancela (mexe em dinheiro) e o garçom não inicia preparo. A
 * tela precisa esconder — mas quem barra de verdade é `set_order_status`.
 * `canCancel` e `canOperate` vêm do servidor, não daqui.
 */
export function permittedActions(
  status: OrderStatus,
  role: { canOperate: boolean; canFinish: boolean; canCancel: boolean },
): KitchenAction[] {
  return availableActions(status).filter((action) => {
    if (action === "cancel") return role.canCancel;
    if (action === "finish") return role.canFinish;
    return role.canOperate;
  });
}

/** Rótulo curto usado no botão de cada ação, com o alvo já resolvido. */
export function actionTarget(action: KitchenAction): OrderStatus {
  return KITCHEN_ACTION_TARGET[action];
}

/* -------------------------------------------------------------------------- */
/* Filtros                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Aplica os filtros de tempo do KDS.
 *
 * Os três filtros de tempo do escopo têm semânticas diferentes e é fácil
 * confundi-los:
 *
 *   • **atrasados** — passou do limite da casa. É urgência, não idade.
 *   • **recentes** — chegou nos últimos 15 minutos. Idade pura, independente de
 *     já estar pronto ou não.
 *
 * Filtrar os dois ao mesmo tempo devolve a interseção, que é o que o usuário
 * espera de dois filtros ligados.
 */
export const RECENT_WINDOW_MINUTES = 15;

export function applyTimeFilters(
  orders: KitchenOrder[],
  options: {
    nowMs: number;
    lateOnly: boolean;
    recentOnly: boolean;
    settings: { late_after_minutes: number; warn_after_minutes: number };
  },
): KitchenOrder[] {
  const { nowMs, lateOnly, recentOnly, settings } = options;

  return orders.filter((order) => {
    if (lateOnly && orderUrgency(order, nowMs, settings) !== "late") return false;
    if (recentOnly && elapsedMinutes(order.created_at, nowMs) > RECENT_WINDOW_MINUTES) {
      return false;
    }
    return true;
  });
}

/** Mesas que aparecem na lista de filtro, sem repetir e em ordem natural. */
export function uniqueTables(orders: KitchenOrder[]): Array<{ id: string; name: string }> {
  const map = new Map<string, string>();
  for (const order of orders) {
    if (!map.has(order.table_id)) map.set(order.table_id, order.table_name);
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    // `localeCompare` com `numeric` põe "Mesa 2" antes de "Mesa 10", que é como
    // a equipe fala. Ordenação por string pura erraria isso.
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
}

/**
 * Quais pedidos são "novos de verdade" — chegados desde a última vez que a
 * cozinha olhou.
 *
 * Serve para o som e o destaque. Comparar com `lastSeenNumber` (e não com um
 * timestamp) é deliberado: `order_number` é monotônico por casa e não empata na
 * mesma transação, ao contrário de `created_at`. Dois pedidos criados no mesmo
 * segundo (mesa grande, dois celulares) apareceriam como um só com timestamp.
 */
export function newArrivals(
  orders: KitchenOrder[],
  lastSeenNumber: number | null,
): KitchenOrder[] {
  if (lastSeenNumber === null) {
    // Primeira carga: nada é "novo". Tocar o som ao abrir a tela assustaria — e
    // o operador não saberia a que pedido o som se referia.
    return [];
  }
  return orders.filter(
    (order) => order.order_number > lastSeenNumber && KITCHEN_COLUMN_OF[order.status] === "new",
  );
}

/** Maior número de pedido da lista — o que vira `lastSeenNumber`. */
export function highestOrderNumber(orders: KitchenOrder[]): number | null {
  if (orders.length === 0) return null;
  return orders.reduce((max, order) => Math.max(max, order.order_number), 0);
}

/* -------------------------------------------------------------------------- */
/* Aviso sonoro                                                              */
/* -------------------------------------------------------------------------- */

/** Chave do `localStorage`. Por restaurante: o mesmo tablet pode servir duas casas. */
export function soundPreferenceKey(restaurantId: string): string {
  return `mv:kitchen-sound:${restaurantId}`;
}

/**
 * Lê a preferência de som.
 *
 * Default **ligado**: numa cozinha, o som é o que faz o pedido ser notado; quem
 * não quer desliga numa configuração visível. O contrário (default mudo)
 * deixaria o painel silencioso na primeira abertura e ninguém descobriria por
 * quê.
 *
 * `localStorage` pode lançar (modo privado, cota, política do aparelho), então
 * tudo é guardado por try/catch. Falhar aqui não pode quebrar a tela.
 */
export function readSoundPreference(restaurantId: string): boolean {
  try {
    const raw = window.localStorage.getItem(soundPreferenceKey(restaurantId));
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

export function writeSoundPreference(restaurantId: string, enabled: boolean): void {
  try {
    window.localStorage.setItem(soundPreferenceKey(restaurantId), enabled ? "1" : "0");
  } catch {
    /* aparelho sem storage: o som continua funcionando nesta sessão */
  }
}

/**
 * Toca o aviso de novo pedido.
 *
 * Web Audio, não `<audio src>`: não exige arquivo no bundle, não depende de
 * rede e não passa pela CSP de `media-src`. Dois bipes curtos e distintos —
 * um som contínuo numa cozinha vira ruído de fundo e deixa de ser notado.
 *
 * **Autoplay:** navegador bloqueia `AudioContext` sem gesto do usuário. A
 * chamada devolve `false` quando isso acontece, e quem chama mostra o botão
 * "Ativar som" — em vez de fingir que tocou. Depois do primeiro toque em
 * qualquer lugar da tela o contexto é retomado e os avisos seguem sozinhos.
 */
export function playNewOrderSound(): boolean {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!Ctor) return false;

    const context = new Ctor();

    if (context.state === "suspended") {
      // Não esperamos a promise: se o navegador bloqueou, `state` continua
      // "suspended" e devolvemos false — a tela pede o gesto.
      void context.resume();
    }

    const beep = (startAt: number, frequency: number) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;

      // Envelope curto: um bipe de 120ms sem rampa estala no alto-falante do
      // tablet. O pico em 0.18 deixa o volume audível na cozinha sem distorcer.
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.12);

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start(startAt);
      oscillator.stop(startAt + 0.14);
    };

    const now = context.currentTime;
    beep(now, 880);
    beep(now + 0.18, 1174);

    // Limpa o contexto depois do som. Deixar aberto segura recurso de áudio no
    // Android e o tablet do KDS fica ligado 10 horas por dia.
    window.setTimeout(() => {
      void context.close();
    }, 600);

    return context.state !== "suspended";
  } catch {
    return false;
  }
}
