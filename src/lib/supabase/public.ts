import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase **sem cookies** — só para leitura pública.
 *
 * ─── Por que este arquivo existe ─────────────────────────────────────────
 *
 * O cliente de `lib/supabase/server.ts` chama `cookies()`, e no App Router
 * qualquer função que lê cookies torna a rota **dinâmica**: o Next não pode
 * mais pré-renderizar nem servir do cache. O cardápio público nunca precisou
 * de sessão — ele lê views `public_*` que já recortam por
 * `status = 'published'` — mas pagava o preço: uma consulta ao banco por
 * visita de cliente, mesmo com `export const revalidate = 60`.
 *
 * Aqui não há cookie, então a página volta a ser ISR: HTML gerado uma vez e
 * servido por 60 s a todo mundo. No salão, com 40 pessoas escaneando o QR ao
 * mesmo tempo, isso é a diferença entre 40 consultas e 0.
 *
 * ─── A segurança não muda ────────────────────────────────────────────────
 *
 * Continua sendo a ANON KEY com RLS ligada, exatamente como antes. A única
 * diferença é que não há JWT de usuário — ou seja, o banco trata a requisição
 * como `anon`, que é o papel mais restrito. Se uma view pública vazasse algo,
 * ela vazaria igual pelo outro cliente: o isolamento é do banco, não do
 * cookie.
 *
 * `persistSession: false` é obrigatório: sem ele, o supabase-js tentaria
 * gravar sessão em `localStorage`/memória num contexto de servidor
 * compartilhado entre requisições.
 */
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return createSupabaseClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      /*
       * O Next tem o seu próprio cache (`revalidate`). Desligar o do
       * supabase-js evita duas camadas de cache discordando sobre quando o
       * cardápio mudou — o sintoma seria "mudei o preço e não aparece".
       */
      fetch: (...args) => fetch(...args),
    },
  });
}
