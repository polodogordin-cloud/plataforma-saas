"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente Supabase para o navegador.
 * Só usa chaves públicas (RLS protege os dados).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

let client: ReturnType<typeof createClient> | undefined;

/** Instância única no navegador. */
export function getBrowserClient() {
  client ??= createClient();
  return client;
}
