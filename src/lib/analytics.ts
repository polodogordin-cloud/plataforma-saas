/**
 * Formatação e cálculo de analytics — Etapa 16.
 *
 * Módulo puro: sem `next/*`, sem `window`, sem `supabase`. É o que permite
 * testar as regras (comparação, "dados insuficientes", labels de gráfico) num
 * harness de Node, sem subir servidor nem banco.
 */

import type { AnalyticsPeriod } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Números e dinheiro                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Dinheiro compacto para caber em card de 320px.
 *
 * `R$ 1.234,56` tem 11 caracteres e estoura o card em telas pequenas — o valor
 * quebra em duas linhas e o card desalinha em relação ao vizinho. Acima de mil
 * reais, mostra `R$ 1,2 mil`; acima de um milhão, `R$ 1,2 mi`. Abaixo disso,
 * o valor completo, porque R$ 45,90 é exatamente o que o dono quer ler.
 *
 * O valor exato continua disponível no `title` do elemento (tooltip) e nos
 * detalhes — a versão curta é para a leitura de relance, não para conferência.
 */
export function formatMoneyCompact(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(safe);

  /*
   * O sinal vai **antes** do "R$", não colado no número.
   *
   * `R$ -1,5 mil` é o que sai da conta ingênua e parece erro de digitação; o
   * correto em pt-BR é `-R$ 1,5 mil`. O `formatMoney` do Intl já faz isso
   * sozinho — esta versão abreviada precisa fazer à mão.
   */
  const sign = safe < 0 ? "-" : "";

  if (abs >= 1_000_000) {
    return `${sign}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  }
  if (abs >= 10_000) {
    // Acima de 10 mil, o centavo não muda decisão nenhuma e os dígitos custam
    // espaço: arredonda para milhar.
    return `${sign}R$ ${Math.round(abs / 1_000).toLocaleString("pt-BR")} mil`;
  }
  if (abs >= 1_000) {
    return `${sign}R$ ${(abs / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  }
  return formatMoney(safe);
}

/** Valor completo em reais. */
export function formatMoney(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(safe);
}

/** Inteiro com separador de milhar. */
export function formatCount(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(safe);
}

/* -------------------------------------------------------------------------- */
/* Comparação entre períodos                                                 */
/* -------------------------------------------------------------------------- */

export type Growth = {
  /** Variação em pontos percentuais, arredondada. `null` quando não há base. */
  percent: number | null;
  direction: "up" | "down" | "flat";
  /** Texto pronto: "+12%", "−8%", "sem base". */
  label: string;
};

/**
 * Variação percentual entre dois períodos.
 *
 * Três casos que precisam de tratamento explícito, e cada um já causou bug em
 * dashboard por aí:
 *
 *   • **base zero** → `null`, não `+∞%` nem `+100%`. Crescer de 0 para 3 não é
 *     "300% de crescimento": não existe percentual de nada. A tela mostra "sem
 *     base de comparação".
 *   • **período anterior sem dados** (`hasData = false`) → `null`, mesmo que a
 *     conta fosse possível: comparar a primeira semana de uma casa com uma
 *     semana em que ela não existia produz "+∞%" com cara de conquista.
 *   • **queda de 100%** → `-100%`, e não `-Infinity`, porque o divisor é o
 *     anterior (que é > 0).
 */
export function computeGrowth(
  current: number,
  previous: number,
  hasPreviousData = true,
): Growth {
  if (!hasPreviousData || previous === 0) {
    return { percent: null, direction: "flat", label: "sem base" };
  }

  const raw = ((current - previous) / previous) * 100;
  const percent = Math.round(raw);

  // Abaixo de 0,5% o arredondamento dá 0: chamar de "estável" é mais honesto
  // que mostrar "0%" com flecha para cima.
  if (percent === 0) {
    return { percent: 0, direction: "flat", label: "estável" };
  }

  const direction = percent > 0 ? "up" : "down";
  // Sinal de menos tipográfico (−, U+2212) alinha melhor que o hífen em fonte
  // tabular e é o que o design system usa nos outros números negativos.
  const label = percent > 0 ? `+${percent}%` : `−${Math.abs(percent)}%`;
  return { percent, direction, label };
}

/* -------------------------------------------------------------------------- */
/* Período                                                                   */
/* -------------------------------------------------------------------------- */

/** `2026-11-21` → `21/11`. Curto porque o espaço é do gráfico. */
export function formatDayShort(iso: string): string {
  const [, month, day] = iso.split("-");
  return day && month ? `${day}/${month}` : iso;
}

/** `2026-11-21` → `21 nov`. Para o eixo e para os títulos. */
export function formatDayLabel(iso: string): string {
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const [, month, day] = iso.split("-");
  const idx = Number(month) - 1;
  return day && months[idx] ? `${day.replace(/^0/, "")} ${months[idx]}` : iso;
}

/**
 * Rótulo humano do período, para o cabeçalho ("21 nov – 27 nov").
 *
 * Um dia só vira "Hoje" / "21 nov" — repetir a mesma data duas vezes
 * ("21 nov – 21 nov") é ruído.
 */
export function describePeriod(preset: AnalyticsPeriod, from: string, to: string): string {
  if (preset === "today") return `Hoje, ${formatDayLabel(to)}`;
  if (preset === "yesterday") return `Ontem, ${formatDayLabel(to)}`;
  if (from === to) return formatDayLabel(from);
  return `${formatDayLabel(from)} – ${formatDayLabel(to)}`;
}

/** `0` → `20h`; `9` → `09h`. Eixo do gráfico de horários. */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}h`;
}

/* -------------------------------------------------------------------------- */
/* Gráficos: escala e "dados insuficientes"                                  */
/* -------------------------------------------------------------------------- */

/**
 * Altura relativa de uma barra, em porcentagem do maior valor.
 *
 * Devolve `0` quando o máximo é 0 — e não `NaN`. Esse `NaN` chega no `style`
 * como `height: NaN%`, o CSS ignora, e a barra fica com altura automática:
 * o gráfico parece cheio num dia sem venda. Foi o teste de gráfico que pegou.
 */
export function barHeightPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  const pct = (value / max) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Há base para desenhar um gráfico de evolução?
 *
 * Uma série de um único dia não é uma evolução: é um ponto. Mostrar um gráfico
 * de linha com um ponto só, ou uma barra sozinha ocupando a largura toda, dá a
 * impressão de que o sistema perdeu dados. Nesses casos a tela mostra o número
 * e uma frase.
 *
 * A regra usa **dias com movimento**, não dias do período: 30 dias em que a
 * casa vendeu em um só não formam tendência.
 */
export function hasEnoughForTrend(daysWithOrders: number): boolean {
  return daysWithOrders >= 2;
}

/** Existe qualquer número para mostrar? (senão, tela de "sem dados") */
export function isEmptyPeriod(summary: {
  orders_count: number;
  paid_value: number;
  waiter_calls: number;
  bill_requests: number;
}): boolean {
  return (
    summary.orders_count === 0 &&
    summary.paid_value === 0 &&
    summary.waiter_calls === 0 &&
    summary.bill_requests === 0
  );
}

/** Maior valor de uma lista, com piso 0. Usado para escalar barras. */
export function maxOf<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((max, item) => Math.max(max, pick(item)), 0);
}

/**
 * Os N itens que concentram a maior parte do volume.
 *
 * Em cardápio com 60 produtos, listar os 60 no celular é rolagem infinita. Dez
 * é o que cabe numa leitura de polegar; o resto vira "outros" só quando o
 * corte realmente esconde algo relevante.
 */
export function topN<T>(items: T[], n: number, pick: (item: T) => number): T[] {
  return [...items].sort((a, b) => pick(b) - pick(a)).slice(0, n);
}

/* -------------------------------------------------------------------------- */
/* Comparação de datas para o filtro personalizado                           */
/* -------------------------------------------------------------------------- */

/**
 * Valida o intervalo digitado no filtro "Personalizado".
 *
 * Devolve a mensagem de erro, ou `null` se estiver ok. As mesmas três regras do
 * banco (`period_required`, `period_inverted`, `period_too_long`), repetidas
 * aqui **só** para o formulário recusar antes de gastar uma requisição. O banco
 * continua sendo quem decide: se as duas regras divergirem, a do banco vence.
 */
export function validateCustomRange(from: string, to: string): string | null {
  if (!from || !to) return "Escolha as duas datas.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return "Data inválida.";
  }
  if (to < from) return "A data final precisa ser depois da inicial.";

  const start = new Date(`${from}T12:00:00Z`).getTime();
  const end = new Date(`${to}T12:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Data inválida.";
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days > 367) return "Escolha um intervalo de até 1 ano.";

  return null;
}
