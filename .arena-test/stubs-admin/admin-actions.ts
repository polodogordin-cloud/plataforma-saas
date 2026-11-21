// Stub das Server Actions para o harness de jsdom.
//
// O harness aponta `@/actions/admin` para este arquivo. As ações reais são
// `"use server"` e importam `next/cache`; aqui elas só registram a chamada e
// respondem o que o teste mandar, para que a verificação seja do comportamento
// da tela (estado, validação, chamada certa), não do banco.
export const calls: Array<{ action: string; args: unknown }> = [];
export let nextResult: { ok: boolean; message?: string; error?: string } = {
  ok: true,
  message: "ok",
};

export function __setResult(result: { ok: boolean; message?: string; error?: string }) {
  nextResult = result;
}

export function __calls() {
  return calls;
}

function record(action: string, args: unknown) {
  calls.push({ action, args });
  return nextResult;
}

export async function setRestaurantStatus(input: unknown) {
  return record("setRestaurantStatus", input);
}

export async function updateRestaurant(input: unknown) {
  return record("updateRestaurant", input);
}

export async function setMemberRole(input: unknown) {
  return record("setMemberRole", input);
}

export async function setMemberStatus(input: unknown) {
  return record("setMemberStatus", input);
}

export async function logSupportAccess(restaurantId: string, note?: string) {
  return record("logSupportAccess", { restaurantId, note });
}

export async function claimPlatformAdmin() {
  return record("claimPlatformAdmin", null);
}
