import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { formatDate } from "@/lib/utils";

/**
 * Tela mostrada ao restaurante suspenso (item 6 do escopo).
 *
 * Por que uma tela e não um 404: o dono precisa saber que **não é um bug** e a
 * quem recorrer. Um "não encontrado" faria a pessoa abrir um ticket dizendo
 * "o sistema caiu".
 *
 * O motivo é escrito pelo admin da plataforma no momento da suspensão. Quando
 * não houver motivo, a tela não inventa um — pede para falar com o suporte.
 */
export function SuspendedNotice({
  restaurantName,
  reason,
  suspendedAt,
}: {
  restaurantName: string | null;
  reason?: string | null;
  suspendedAt?: string | null;
}) {
  return (
    <main className="app-shell flex min-h-dvh flex-col items-center justify-center px-6 py-10 text-center">
      <span className="grid size-16 place-items-center rounded-2xl bg-red-50 text-red-600">
        <ShieldAlert className="size-8" aria-hidden="true" />
      </span>

      <h1 className="mt-4 text-xl font-semibold text-ink-900">
        {restaurantName ? `${restaurantName} está suspenso` : "Restaurante suspenso"}
      </h1>

      <p className="mt-2 max-w-sm text-[0.95rem] leading-relaxed text-ink-600">
        O acesso ao painel e ao cardápio público está temporariamente bloqueado
        pela plataforma. Seus dados continuam guardados — nada foi apagado.
      </p>

      {reason && (
        <div className="mt-4 w-full max-w-sm rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Motivo</p>
          <p className="mt-1 text-sm leading-relaxed text-red-800">{reason}</p>
          {suspendedAt && (
            <p className="mt-1.5 text-[0.7rem] text-red-600">
              Desde {formatDate(suspendedAt)}
            </p>
          )}
        </div>
      )}

      <p className="mt-4 max-w-sm text-sm text-ink-500">
        Para reativar, fale com o suporte da plataforma. Só a equipe da plataforma
        pode remover a suspensão.
      </p>

      <Link
        href="/"
        className="tap-target mt-6 inline-flex items-center rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white"
      >
        Voltar ao início
      </Link>
    </main>
  );
}
