const store = (globalThis.__wbDataStub ??= { rows: null, row: null, error: null, calls: [] });
module.exports = {
  createClient: async () => ({
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
