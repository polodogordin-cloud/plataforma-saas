// Stub das Server Actions de cobrança (Etapa 19) para o harness de jsdom.
//
// As ações reais são `"use server"` e importam `next/cache`/Supabase; aqui elas
// registram a chamada e devolvem o que o teste mandar. Isso deixa o harness
// verificar **o que a tela envia** — que é onde o valor adulterado apareceria.
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

export function __reset() {
  calls.length = 0;
  nextResult = { ok: true, message: "ok" };
}

function record(action: string, args: unknown) {
  calls.push({ action, args });
  return nextResult;
}

export async function requestMyPayment(input: unknown) {
  return record("requestMyPayment", input);
}

export async function submitPaymentReceipt(input: unknown) {
  return record("submitPaymentReceipt", input);
}

export async function confirmPayment(input: unknown) {
  return record("confirmPayment", input);
}

export async function rejectPayment(input: unknown) {
  return record("rejectPayment", input);
}

export async function cancelPendingPayment(input: unknown) {
  return record("cancelPendingPayment", input);
}

export async function savePaymentSettings(input: unknown) {
  return record("savePaymentSettings", input);
}
