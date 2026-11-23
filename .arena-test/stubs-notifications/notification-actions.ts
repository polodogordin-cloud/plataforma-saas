// Stub das Server Actions de notificação para o harness de jsdom.
// As ações reais são `"use server"` e importam `next/cache`; aqui registram a
// chamada e devolvem o que o teste mandar. O comportamento de banco está no
// harness de segurança.
export type Call = { action: string; args: unknown };

export const calls: Call[] = [];
export let nextResult: { ok: boolean; data?: { changed?: number } } | { ok: false; error: string } = {
  ok: true,
  data: { changed: 1 },
};

export function __reset(): void {
  calls.length = 0;
  nextResult = { ok: true, data: { changed: 1 } };
}

export function __setResult(result: typeof nextResult): void {
  nextResult = result;
}

export function __calls(): Call[] {
  return calls;
}

export async function markNotificationRead(id: string) {
  calls.push({ action: "markNotificationRead", args: id });
  return nextResult;
}

export async function markAllNotificationsRead() {
  calls.push({ action: "markAllNotificationsRead", args: null });
  return nextResult;
}

export async function saveNotificationPreferences(input: unknown) {
  calls.push({ action: "saveNotificationPreferences", args: input });
  return nextResult;
}
