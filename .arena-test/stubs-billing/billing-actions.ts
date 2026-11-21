// Stub das Server Actions de assinatura para o harness de jsdom.
// As ações reais são `"use server"` e importam `next/cache`; aqui registram a
// chamada e devolvem o que o teste mandar, para verificar comportamento de tela.
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

export async function changeMyPlan(input: unknown) {
  return record("changeMyPlan", input);
}

export async function startMyTrial() {
  return record("startMyTrial", null);
}

export async function cancelMySubscription(input: unknown) {
  return record("cancelMySubscription", input);
}

export async function savePlan(input: unknown) {
  return record("savePlan", input);
}

export async function togglePlan(id: string, active: boolean) {
  return record("togglePlan", { id, active });
}

export async function setSubscription(input: unknown) {
  return record("setSubscription", input);
}

export async function setPlatformSetting(input: unknown) {
  return record("setPlatformSetting", input);
}

export async function reviewSubscriptions() {
  return record("reviewSubscriptions", null);
}
