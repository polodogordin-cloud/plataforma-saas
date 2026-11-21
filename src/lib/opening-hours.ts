import type {
  DayHours,
  OpeningHours,
  OpeningState,
  PublicRestaurant,
  Weekday,
} from "@/lib/types";

/**
 * Horário de funcionamento do cardápio público.
 *
 * Regras:
 *  - O fuso é o do restaurante (`restaurants.timezone`), não o do visitante.
 *    Quem abre o link de outro estado precisa ver o horário da loja.
 *  - O texto nunca afirma "aberto" sem dados: sem `opening_hours` configurado,
 *    o cardápio mostra apenas o status comercial.
 *  - `status` comercial manda: rascunho/pausado/fechado nunca aparece como
 *    aberto, mesmo dentro do horário.
 */

const WEEKDAY_ORDER: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** "18:30" -> 1110 minutos. Ignora segundos e valores inválidos. */
export function parseTime(value: string | undefined | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 1110 -> "18:30" */
export function formatTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const rest = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** Dia da semana e minutos do dia no fuso do restaurante. */
export function nowInTimezone(
  timeZone: string,
  reference: Date = new Date(),
): { weekday: Weekday; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(reference);
  } catch {
    // Fuso inválido: cai no horário local do servidor em vez de quebrar a página.
    parts = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(reference);
  }

  const map = new Map(parts.map((part) => [part.type, part.value]));
  const short = (map.get("weekday") ?? "mon").toLowerCase();
  const index = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(short.slice(0, 3));

  const hours = Number(map.get("hour") ?? "0") % 24;
  const minutes = Number(map.get("minute") ?? "0");

  return {
    weekday: WEEKDAY_ORDER[(index + 6) % 7] ?? "mon",
    minutes: hours * 60 + minutes,
  };
}

/** Lê `settings.opening_hours` com tolerância a dados parciais. */
export function readOpeningHours(
  settings: Record<string, unknown> | null | undefined,
): OpeningHours | null {
  const raw = settings?.opening_hours;
  if (!raw || typeof raw !== "object") return null;

  const result: OpeningHours = {};
  let found = false;

  for (const day of WEEKDAY_ORDER) {
    const entry = (raw as Record<string, unknown>)[day];
    if (!entry || typeof entry !== "object") continue;

    const closed = Boolean((entry as Record<string, unknown>).closed);
    const open = String((entry as Record<string, unknown>).open ?? "");
    const close = String((entry as Record<string, unknown>).close ?? "");

    if (!closed && (parseTime(open) === null || parseTime(close) === null)) continue;

    result[day] = { closed, open, close } satisfies DayHours;
    found = true;
  }

  return found ? result : null;
}

/**
 * Próxima abertura real a partir de `fromDay`/`fromMinutes`.
 *
 * "Hoje" só conta se o horário de abertura ainda não passou — senão o cardápio
 * diria "abre hoje às 18:00" às 23h45.
 */
function nextOpening(
  hours: OpeningHours,
  fromDay: Weekday,
  fromMinutes: number,
): { day: Weekday; open: string; daysAhead: number } | null {
  const start = WEEKDAY_ORDER.indexOf(fromDay);

  for (let offset = 0; offset < 8; offset += 1) {
    const day = WEEKDAY_ORDER[(start + offset) % 7];
    if (!day) continue;
    const entry = hours[day];
    if (!entry || entry.closed) continue;

    if (offset === 0) {
      const open = parseTime(entry.open);
      if (open === null || open <= fromMinutes) continue;
    }

    return { day, open: entry.open, daysAhead: offset };
  }
  return null;
}

/**
 * Situação de abertura para exibir na capa do cardápio.
 *
 * Trata intervalo que atravessa a meia-noite (18:00 → 02:00), comparando com o
 * dia anterior.
 */
export function getOpeningState(
  restaurant: Pick<PublicRestaurant, "status" | "settings">,
  timeZone: string,
  reference: Date = new Date(),
): OpeningState | null {
  const hours = readOpeningHours(restaurant.settings);
  if (!hours) return null;

  if (restaurant.status !== "published") {
    return {
      state: "away",
      label: "Cardápio indisponível no momento",
      detail: "Volte mais tarde.",
    };
  }

  const { weekday, minutes } = nowInTimezone(timeZone, reference);
  const today = hours[weekday];
  const yesterdayIndex = (WEEKDAY_ORDER.indexOf(weekday) + 6) % 7;
  const yesterday = hours[WEEKDAY_ORDER[yesterdayIndex] ?? "sun"];

  // Turno que começou ontem e passa da meia-noite (ex.: 18:00 -> 02:00).
  if (yesterday && !yesterday.closed) {
    const open = parseTime(yesterday.open);
    const close = parseTime(yesterday.close);
    if (open !== null && close !== null && close < open && minutes < close) {
      return { state: "open", label: `Aberto até ${yesterday.close}` };
    }
  }

  if (today && !today.closed) {
    const open = parseTime(today.open);
    const close = parseTime(today.close);

    if (open !== null && close !== null) {
      const crossesMidnight = close < open;

      if (crossesMidnight) {
        if (minutes >= open) return { state: "open", label: `Aberto até ${today.close}` };
      } else if (minutes >= open && minutes < close) {
        return { state: "open", label: `Aberto até ${today.close}` };
      }

      if (minutes < open) {
        return { state: "closed", label: `Abre hoje às ${today.open}` };
      }
    }
  }

  const next = nextOpening(hours, weekday, minutes);
  if (!next) return { state: "closed", label: "Fechado" };

  const when =
    next.daysAhead === 0
      ? `hoje às ${next.open}`
      : next.daysAhead === 1
        ? `amanhã às ${next.open}`
        : `na ${WEEKDAY_LABEL_DAY(next.day)} às ${next.open}`;

  return { state: "closed", label: `Fechado · abre ${when}` };
}

function WEEKDAY_LABEL_DAY(day: Weekday): string {
  const labels: Record<Weekday, string> = {
    mon: "segunda",
    tue: "terça",
    wed: "quarta",
    thu: "quinta",
    fri: "sexta",
    sat: "sábado",
    sun: "domingo",
  };
  return labels[day];
}

/** Lista legível de horários, para a seção "Horários" do cardápio. */
export function describeWeek(hours: OpeningHours): Array<{
  day: Weekday;
  label: string;
  text: string;
}> {
  return WEEKDAY_ORDER.filter((day) => hours[day]).map((day) => {
    const entry = hours[day]!;
    return {
      day,
      label: WEEKDAY_LABEL_DAY(day),
      text: entry.closed ? "Fechado" : `${entry.open} – ${entry.close}`,
    };
  });
}
