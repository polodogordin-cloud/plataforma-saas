/** Stub das ações do KDS para o harness — registra chamadas e devolve sucesso. */
export type Call = { orderId: string; status: string };

export const calls: Call[] = [];
export let nextError: string | null = null;

export function __reset(): void {
  calls.length = 0;
  nextError = null;
}

export function __failWith(message: string | null): void {
  nextError = message;
}

export async function advanceKitchenOrder(input: {
  orderId: string;
  status: string;
}): Promise<{ ok: true; status: string; updatedAt: string } | { ok: false; error: string }> {
  calls.push({ orderId: input.orderId, status: input.status });
  if (nextError) return { ok: false, error: nextError };
  return { ok: true, status: input.status, updatedAt: new Date().toISOString() };
}

export async function refreshKitchenOrders(): Promise<{
  orders: unknown[];
  lateAfter: number;
  warnAfter: number;
}> {
  return { orders: [], lateAfter: 15, warnAfter: 10 };
}
