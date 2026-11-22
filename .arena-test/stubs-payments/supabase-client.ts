// Stub do cliente Supabase do navegador para o harness de jsdom.
//
// O upload de comprovante chama `storage.from(bucket).upload(path, file, ...)`.
// Aqui o upload é registrado e sempre bem-sucedido: o alvo do teste é o
// **caminho** e o **payload** que a tela entrega, não o Storage (que é testado
// pelas policies no banco).
export const uploads: Array<{ bucket: string; path: string; contentType?: string }> = [];

export function __uploads() {
  return uploads;
}

export function getBrowserClient() {
  return {
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, _file: unknown, options?: { contentType?: string }) {
            uploads.push({ bucket, path, contentType: options?.contentType });
            return { error: null };
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}` } };
          },
        };
      },
    },
  };
}
