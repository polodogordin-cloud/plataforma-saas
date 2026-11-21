// Stub do cliente Supabase **sem cookies** (lib/supabase/public).
//
// A Etapa 14 mudou as leituras públicas do cardápio para este cliente, que é
// síncrono. O harness aponta o alias para cá e o estado continua em
// `globalThis.__wbDataStub`, para que o stub e o teste vejam o mesmo objeto
// mesmo com o esbuild inlinando o módulo.
const store = (globalThis.__wbDataStub ??= { rows: null, row: null, error: null, calls: [] });

module.exports = {
  createPublicClient: () => ({
    rpc: async (fn, args) => {
      store.calls.push({ fn, args });
      return { data: store.rows, error: store.error };
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: store.row, error: store.error }) }),
      }),
    }),
  }),
};
