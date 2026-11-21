export function getBrowserClient() {
  return {
    storage: {
      from() {
        return {
          upload(path: string) {
            const s = (globalThis as any).__THEME__ ||= { saves: [], uploads: [] };
            s.uploadedPath = path;
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };
}
