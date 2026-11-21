const store = (globalThis.__whatsappActionStub ??= { calls: [], response: null });
function saveWhatsappSettings(input) {
  store.calls.push(input);
  if (store.response) return Promise.resolve(store.response(input));
  return Promise.resolve({
    ok: true,
    config: { phone: input.phone ? "5511999990000" : null, message: input.message, isActive: input.isActive },
    message: input.isActive ? "WhatsApp ativado no cardápio." : "WhatsApp desativado.",
  });
}
module.exports = { saveWhatsappSettings, deactivateWhatsapp: async () => ({ ok: true }) };
