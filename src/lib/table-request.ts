import type { TableRequestState, TableRequestStatus, TableRequestType } from "@/lib/types";

/**
 * Regras de apresentação das solicitações da mesa — módulo neutro.
 *
 * O banco é quem manda (índice único para solicitação viva + cooldown de 120s).
 * Aqui só traduzimos esse estado para o que a tela deve mostrar, para o cliente
 * não tocar num botão que vai ser recusado:
 *
 *   - já existe solicitação viva  → "Solicitação já enviada" + quando
 *   - dentro do cooldown          → botão desabilitado com contagem
 *   - caso contrário              → botão ativo
 */

/** Cooldown em segundos — espelha `table_request_cooldown_seconds()` no banco. */
export const TABLE_REQUEST_COOLDOWN_SECONDS = 120;

export type RequestAvailability = {
  /** Pode enviar agora? */
  canSend: boolean;
  /** Já existe uma solicitação viva deste tipo. */
  alreadySent: boolean;
  /** Status da solicitação viva, quando houver. */
  liveStatus: TableRequestStatus | null;
  /** Quando a solicitação viva foi criada. */
  since: string | null;
  /** Segundos restantes de cooldown (0 quando livre). */
  cooldownLeft: number;
};

/** Quanto falta do cooldown, em segundos inteiros (nunca negativo). */
export function cooldownRemaining(
  cooldownUntilIso: string | null | undefined,
  now: number = Date.now(),
): number {
  if (!cooldownUntilIso) return 0;
  const until = Date.parse(cooldownUntilIso);
  if (Number.isNaN(until)) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * Traduz o estado da mesa para a disponibilidade de um tipo de solicitação.
 *
 * O cooldown do banco é por tipo (a query em `create_table_request` filtra por
 * `type`), mas `get_table_request_state` devolve só o da última solicitação de
 * qualquer tipo. Somos conservadores aqui: se qualquer tipo está em cooldown,
 * mostramos contagem — melhor esperar 30s do que bater no erro.
 */
export function requestAvailability(
  state: TableRequestState | null,
  type: TableRequestType,
  now: number = Date.now(),
): RequestAvailability {
  if (!state) {
    return {
      canSend: true,
      alreadySent: false,
      liveStatus: null,
      since: null,
      cooldownLeft: 0,
    };
  }

  const liveStatus = type === "waiter" ? state.waiter_status : state.bill_status;
  const since = type === "waiter" ? state.waiter_since : state.bill_since;

  if (liveStatus) {
    return {
      canSend: false,
      alreadySent: true,
      liveStatus,
      since,
      cooldownLeft: 0,
    };
  }

  const cooldownLeft = cooldownRemaining(state.cooldown_until, now);

  return {
    canSend: cooldownLeft === 0,
    alreadySent: false,
    liveStatus: null,
    since: null,
    cooldownLeft,
  };
}

/** Texto do botão quando em cooldown: "Aguarde 45s". */
export function cooldownLabel(seconds: number): string {
  if (seconds <= 0) return "";
  if (seconds < 60) return `Aguarde ${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `Aguarde ${minutes} min`;
}

/** "Solicitação já enviada" + detalhe por status, para o painel do cliente. */
export function alreadySentLabel(status: TableRequestStatus): string {
  if (status === "acknowledged") return "Um atendente está indo até a mesa.";
  return "Solicitação já enviada. Aguarde o atendimento.";
}
