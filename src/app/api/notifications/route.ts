import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeNotification } from "@/lib/notifications";

/**
 * `GET /api/notifications` — lista do painel, para o cliente.
 *
 * Por que uma rota e não uma Server Action: a lista é lida em três situações
 * diferentes (montar o sino, abrir o painel, reconectar o canal) e sempre em
 * resposta a um evento — nem toda elas vêm de um `<form>`. Uma action devolveria
 * o mesmo formato, mas com semântica de mutação e `revalidatePath` desnecessário.
 *
 * A autorização não está aqui: a RPC `list_notifications` filtra por `auth.uid()`
 * e `is_restaurant_member`. Sem sessão, ela devolve vazio — e esta rota devolve
 * 401 para o cliente não achar que "não há notificações" quando não há login.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 30), 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  const { data, error } = await supabase.rpc("list_notifications", {
    p_limit: limit,
    p_offset: offset,
    p_unread_only: unreadOnly,
  });

  if (error) {
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      notifications: rows.map(normalizeNotification),
      unread: rows.length > 0 ? Number(rows[0]!.unread_count ?? 0) : 0,
    },
    // Nunca cacheado: notificação velha é pior que notificação nenhuma.
    { headers: { "Cache-Control": "no-store" } },
  );
}
