/**
 * Stub do hook de tempo real.
 * O harness não abre WebSocket: aqui o estado é fixo e o callback nunca dispara.
 * O que se prova na UI é a reação ao ESTADO, não o transporte (que já é o mesmo
 * do painel da Etapa 7, coberto por outros harnesses).
 */
export type RealtimeState = "connecting" | "live" | "offline";

export const __state: { value: RealtimeState } = { value: "live" };

export function useOrdersRealtime(_args: { onChange: (p: unknown) => void }): {
  state: RealtimeState;
  ticks: number;
} {
  return { state: __state.value, ticks: 0 };
}
