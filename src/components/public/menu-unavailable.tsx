import Link from "next/link";
import { ShieldAlert, Store } from "lucide-react";

/**
 * Mensagens do cardápio quando ele não pode ser mostrado.
 *
 * Três situações diferentes, três textos diferentes — porque a ação do cliente
 * muda em cada uma:
 *
 *   • `suspended` → a plataforma bloqueou a casa. Nada a fazer no salão além de
 *     chamar alguém; insistir não resolve.
 *   • `unpublished` → a casa ainda não publicou / pausou o cardápio. Voltar mais
 *     tarde faz sentido.
 *   • `table` → a mesa foi desativada. Chamar um atendente resolve na hora.
 *
 * Em nenhum caso revelamos se o token existe: a mensagem de mesa é a mesma para
 * token inválido, mesa desativada e casa fechada (Etapa 9 já fazia isso, e é o
 * comportamento certo).
 */
type Reason = "suspended" | "unpublished" | "table";

export function MenuUnavailable({
  reason,
  restaurantName,
}: {
  reason: Reason;
  restaurantName?: string | null;
}) {
  const content = {
    suspended: {
      icon: <ShieldAlert className="size-6" aria-hidden="true" />,
      tone: "bg-red-50 text-red-600",
      title: "Cardápio temporariamente indisponível",
      body: (
        <>
          {restaurantName ? (
            <>
              O cardápio de <strong>{restaurantName}</strong> está fora do ar no
              momento.
            </>
          ) : (
            "Este cardápio está fora do ar no momento."
          )}{" "}
          Chame um atendente — ele resolve rapidinho.
        </>
      ),
      showHome: false,
    },
    unpublished: {
      icon: <Store className="size-6" aria-hidden="true" />,
      tone: "bg-amber-50 text-amber-700",
      title: "Cardápio não publicado",
      body: (
        <>
          {restaurantName ? (
            <>
              <strong>{restaurantName}</strong> ainda não publicou o cardápio
              digital.
            </>
          ) : (
            "Este restaurante ainda não publicou o cardápio digital."
          )}{" "}
          Volte mais tarde ou pergunte no balcão.
        </>
      ),
      showHome: true,
    },
    table: {
      icon: <span aria-hidden="true" className="text-xl">🪑</span>,
      tone: "bg-amber-50 text-amber-700",
      title: "Esta mesa não está disponível",
      body: (
        <>
          O cardápio está fechado no momento ou esta mesa foi desativada. Chame
          um atendente — ele resolve rapidinho.
        </>
      ),
      showHome: false,
    },
  }[reason];

  return (
    <main className="grid min-h-dvh place-items-center bg-ink-50 px-5 py-10">
      <div className="w-full max-w-sm rounded-[var(--radius-card)] border border-ink-200 bg-white p-6 text-center">
        <span className={`mx-auto grid size-12 place-items-center rounded-2xl ${content.tone}`}>
          {content.icon}
        </span>
        <h1 className="mt-3 text-lg font-semibold text-ink-900">{content.title}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{content.body}</p>
        {content.showHome && (
          <Link
            href="/"
            className="tap-target mt-4 inline-flex items-center rounded-xl px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Conhecer o Menuvo
          </Link>
        )}
      </div>
    </main>
  );
}
