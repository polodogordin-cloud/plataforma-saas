"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { barHeightPercent, formatDayShort, formatHour, maxOf } from "@/lib/analytics";
import type { AnalyticsDay, AnalyticsHour } from "@/lib/types";

/**
 * Gráficos do analytics — Etapa 16.
 *
 * ─── Por que não instalar uma biblioteca ────────────────────────────────────
 *
 * O projeto não tem biblioteca de gráficos instalada, e o escopo diz para usar
 * uma "caso já exista uma". Não existia. Adicionar Recharts (~100 kB gzip,
 * mais `d3-*` no bundle) para desenhar quatro séries de barras contradiz o
 * item 6 do escopo — menos JS no cardápio — e o módulo inteiro não pesa mais
 * que os gráficos.
 *
 * O que está aqui é SVG e CSS puro: barras com `height: %`, linhas com
 * `polyline`. Sem dependência, sem canvas, sem `requestAnimationFrame`.
 * Funciona com SSR, imprime, e o leitor de tela lê a `<table>` equivalente que
 * vai no `sr-only` de cada gráfico.
 *
 * ─── Acessibilidade que não é enfeite ──────────────────────────────────────
 *
 * Gráfico é imagem: para quem usa leitor de tela, ele tem que existir como
 * dado. Cada componente acompanha uma tabela oculta com os mesmos números —
 * a mesma informação, em forma navegável.
 *
 * ─── 320px ─────────────────────────────────────────────────────────────────
 *
 * Nada de eixo Y fixo com labels: em 320px sobram ~280px para o plot e o eixo
 * comeria 50. O valor máximo vai como texto no topo do card e cada barra tem
 * `aria-label` com o número exato. Rótulo do eixo X aparece só nos pontos
 * extremos e no pico, que é o que se lê de relance.
 */

const BRAND = "#0f9250";
const BRAND_SOFT = "#b0f1c9";

/* -------------------------------------------------------------------------- */
/* Barras verticais: vendas por dia, pedidos por dia                        */
/* -------------------------------------------------------------------------- */

export function DailyBars({
  data,
  metric,
  formatValue,
  highlightLast = true,
}: {
  data: AnalyticsDay[];
  metric: "orders_value" | "orders_count";
  formatValue: (value: number) => string;
  /** Destaca o último dia (hoje) — é o que o dono procura primeiro. */
  highlightLast?: boolean;
}) {
  const tableId = useId();
  const max = maxOf(data, (d) => d[metric]);

  if (data.length === 0) return null;

  return (
    <div>
      {/*
       * Barra por dia. `min-h` garante que uma venda pequena ainda apareça —
       * sem o piso, um dia de R$ 5 ao lado de um de R$ 500 vira uma linha
       * invisível, e o dono acha que não vendeu.
       */}
      <div
        className="flex items-end gap-[3px] sm:gap-1"
        style={{ height: 132 }}
        role="img"
        aria-describedby={tableId}
      >
        {data.map((point, index) => {
          const value = point[metric];
          const pct = barHeightPercent(value, max);
          const isLast = highlightLast && index === data.length - 1;
          const isPeak = value > 0 && value === max;
          const hasValue = value > 0;

          return (
            <div key={point.day} className="group relative flex h-full flex-1 flex-col justify-end">
              <div
                className={cn(
                  "w-full rounded-t-[3px] transition-[height] duration-500 ease-[var(--ease-out-soft)]",
                  isLast ? "bg-brand-600" : isPeak ? "bg-brand-500" : "bg-brand-300",
                  !hasValue && "bg-ink-100",
                )}
                style={{ height: hasValue ? `max(${pct}%, 4px)` : "3px" }}
                title={`${formatDayShort(point.day)}: ${formatValue(value)}`}
              />
            </div>
          );
        })}
      </div>

      {/* Eixo X: só as pontas. O meio é ruído em 320px. */}
      <div className="mt-1.5 flex justify-between text-[0.65rem] text-ink-400">
        <span>{formatDayShort(data[0]!.day)}</span>
        {data.length > 2 && (
          <span className="text-ink-500">{formatDayShort(data[Math.floor(data.length / 2)]!.day)}</span>
        )}
        <span>{formatDayShort(data[data.length - 1]!.day)}</span>
      </div>

      <table id={tableId} className="sr-only">
        <caption>Valores por dia</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            <th scope="col">Valor</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.day}>
              <th scope="row">{formatDayShort(point.day)}</th>
              <td>{formatValue(point[metric])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Linha: evolução das vendas                                                */
/* -------------------------------------------------------------------------- */

/**
 * Série de linha com área — "evolução das vendas ao longo do tempo".
 *
 * `viewBox` de 320×120 com `preserveAspectRatio="none"`: o SVG estica para a
 * largura do card sem precisar medir o container em JS (`ResizeObserver` seria
 * mais código e um re-render por rotação de tela). O custo é que a espessura do
 * traço escala junto — por isso `vectorEffect="non-scaling-stroke"`, que
 * mantém 2px reais em qualquer largura.
 */
export function TrendArea({
  data,
  metric,
  formatValue,
}: {
  data: AnalyticsDay[];
  metric: "orders_value" | "orders_count";
  formatValue: (value: number) => string;
}) {
  const tableId = useId();
  const gradientId = useId().replace(/:/g, "");

  if (data.length < 2) return null;

  const values = data.map((d) => d[metric]);
  const max = Math.max(...values, 1);
  const width = 320;
  const height = 120;
  const stepX = width / (data.length - 1);

  const points = values.map((value, index) => {
    const x = index * stepX;
    const y = height - (value / max) * (height - 8) - 4;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const line = `M ${points.join(" L ")}`;
  const area = `${line} L ${width},${height} L 0,${height} Z`;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-[120px] w-full"
        role="img"
        aria-describedby={tableId}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity="0.22" />
            <stop offset="100%" stopColor={BRAND} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={BRAND}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* Último ponto marcado: onde a leitura pousa. */}
        <circle
          cx={width}
          cy={values[values.length - 1]! === 0 ? height - 4 : height - (values[values.length - 1]! / max) * (height - 8) - 4}
          r="3"
          fill={BRAND}
        />
      </svg>

      <div className="mt-1 flex justify-between text-[0.65rem] text-ink-400">
        <span>{formatDayShort(data[0]!.day)}</span>
        <span>{formatDayShort(data[data.length - 1]!.day)}</span>
      </div>

      <table id={tableId} className="sr-only">
        <caption>Evolução do período</caption>
        <tbody>
          {data.map((point) => (
            <tr key={point.day}>
              <th scope="row">{formatDayShort(point.day)}</th>
              <td>{formatValue(point[metric])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Horários de pico                                                          */
/* -------------------------------------------------------------------------- */

/**
 * 24 barras finas, uma por hora.
 *
 * Em 320px cada barra fica com ~9px: o suficiente para ver a forma do dia
 * (almoço, jantar) e insuficiente para rótulo em cada uma. Por isso o rótulo
 * aparece só nos extremos e na hora de pico, e a tabela oculta tem tudo.
 */
export function HoursBars({ data }: { data: AnalyticsHour[] }) {
  const tableId = useId();
  const max = maxOf(data, (d) => d.orders_count);
  const peak = data.reduce<AnalyticsHour | null>(
    (best, hour) => (best === null || hour.orders_count > best.orders_count ? hour : best),
    null,
  );

  if (data.length === 0) return null;

  return (
    <div>
      <div
        className="flex items-end gap-[2px]"
        style={{ height: 96 }}
        role="img"
        aria-describedby={tableId}
        aria-label={
          peak && peak.orders_count > 0
            ? `Pico às ${formatHour(peak.hour)}, com ${peak.orders_count} pedidos`
            : "Sem pedidos no período"
        }
      >
        {data.map((hour) => {
          const pct = barHeightPercent(hour.orders_count, max);
          const isPeak = peak !== null && hour.hour === peak.hour && hour.orders_count > 0;
          return (
            <div key={hour.hour} className="flex h-full flex-1 flex-col justify-end">
              <div
                className={cn(
                  "w-full rounded-t-[2px]",
                  isPeak ? "bg-amber-500" : hour.orders_count > 0 ? "bg-brand-300" : "bg-ink-100",
                )}
                style={{ height: hour.orders_count > 0 ? `max(${pct}%, 3px)` : "2px" }}
                title={`${formatHour(hour.hour)}: ${hour.orders_count} pedidos`}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex justify-between text-[0.65rem] text-ink-400">
        <span>00h</span>
        <span>06h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>

      <table id={tableId} className="sr-only">
        <caption>Pedidos por hora do dia</caption>
        <tbody>
          {data.map((hour) => (
            <tr key={hour.hour}>
              <th scope="row">{formatHour(hour.hour)}</th>
              <td>{hour.orders_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Barras horizontais: categorias e métodos de pagamento                     */
/* -------------------------------------------------------------------------- */

export type RankedBarItem = {
  key: string;
  label: string;
  value: number;
  /** Texto do valor ("12 un.", "R$ 340,00"). */
  valueLabel: string;
};

/**
 * Lista ranqueada com barra de progresso.
 *
 * Preferida sobre gráfico de pizza no celular: pizza de 6 fatias em 320px não
 * se lê (as fatias pequenas ficam com 2px de ângulo e o rótulo não cabe), e
 * porcentagem em ângulo é a pior forma de comparar dois números. Barra
 * horizontal compara comprimento, que o olho lê bem em qualquer tamanho.
 */
export function RankedBars({ items }: { items: RankedBarItem[] }) {
  const max = maxOf(items, (i) => i.value);

  if (items.length === 0) return null;

  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.key}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-[0.82rem] font-medium text-ink-800" title={item.label}>
              {item.label}
            </span>
            <span className="shrink-0 text-[0.78rem] font-semibold tabular-nums text-ink-600">
              {item.valueLabel}
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-ink-100"
            role="img"
            aria-label={`${item.label}: ${item.valueLabel}`}
          >
            <div
              className="h-full rounded-full bg-brand-500"
              style={{ width: `${barHeightPercent(item.value, max)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export { BRAND, BRAND_SOFT };
