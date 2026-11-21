/**
 * Tempo de espera — o dado mais importante do painel.
 *
 * "Há quanto tempo esse pedido está parado?" é a pergunta que organiza o
 * salão, então ela aparece no card o tempo todo, em texto curto:
 *
 *   agora · 3 min · 1h05 · 2d
 *
 * Funções puras e sem fuso: recebem ISO e devolvem string. Quem chama decide o
 * "agora" — o que também deixa isso testável sem congelar relógio.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Diferença em milissegundos, nunca negativa (relógio do celular pode atrasar). */
export function elapsedMs(fromIso: string, now: number = Date.now()): number {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, now - from);
}

/** "agora", "3 min", "1h05", "2d 3h". */
export function orderAgeLabel(fromIso: string, now: number = Date.now()): string {
  const ms = elapsedMs(fromIso, now);

  if (ms < MINUTE) return "agora";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;

  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return `${hours}h${String(minutes).padStart(2, "0")}`;
  }

  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

/**
 * Alerta de espera longa.
 *
 * A cozinha não precisa de um cronômetro em cada card; precisa saber quando
 * algo passou do razoável. 15 minutos é o limite usado aqui — comum em salão,
 * e curto o bastante para agir antes do cliente reclamar.
 */
export const ORDER_LATE_MS = 15 * MINUTE;

export type AgeLevel = "fresh" | "warn" | "late";

export function orderAgeLevel(fromIso: string, now: number = Date.now()): AgeLevel {
  const ms = elapsedMs(fromIso, now);
  if (ms >= ORDER_LATE_MS) return "late";
  if (ms >= 8 * MINUTE) return "warn";
  return "fresh";
}

/** "14:32" no fuso da casa, para o detalhe do pedido. */
export function orderClock(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
}

/** "21/11/2026" no fuso da casa. */
export function orderDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleDateString("pt-BR");
  }
}
