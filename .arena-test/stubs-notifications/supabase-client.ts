/**
 * Stub do cliente Supabase para o harness — só o suficiente para o hook montar.
 *
 * O `channel` guarda os callbacks para o teste conseguir *entregar* um evento de
 * tempo real (INSERT/UPDATE) e conferir a reação da tela. Sem isso, o caminho
 * mais importante do sino — "chegou pedido com o painel aberto" — ficaria fora
 * do teste e só existiria em produção.
 */

type Payload = { eventType?: string; new?: Record<string, unknown>; old?: Record<string, unknown> };

const listeners: Array<(payload: Payload) => void> = [];
const statusListeners: Array<(status: string) => void> = [];

export const __control = {
  /** Último filtro pedido ao Supabase. */
  filter: null as string | null,
  /** Chamadas de `removeChannel`. */
  removed: 0,
  /** Quantas vezes o canal foi criado. */
  created: 0,
  deliver(payload: Payload) {
    for (const listener of [...listeners]) listener(payload);
  },
  status(value: string) {
    for (const listener of [...statusListeners]) listener(value);
  },
  reset() {
    listeners.length = 0;
    statusListeners.length = 0;
    __control.filter = null;
    __control.removed = 0;
    __control.created = 0;
  },
};

const channel = {
  on(_event: string, config: { filter?: string }, callback: (payload: Payload) => void) {
    __control.filter = config.filter ?? null;
    listeners.push(callback);
    return channel;
  },
  subscribe(callback?: (status: string) => void) {
    if (callback) statusListeners.push(callback);
    return channel;
  },
};

export function getBrowserClient() {
  return {
    channel() {
      __control.created += 1;
      return channel;
    },
    async removeChannel() {
      __control.removed += 1;
      return "ok";
    },
  };
}
