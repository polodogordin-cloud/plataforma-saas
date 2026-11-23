import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronRight,
  ListChecks,
  Receipt,
  CreditCard,
  LifeBuoy,
  LogOut,
  MessageCircle,
  Palette,
  Printer,
  ShieldCheck,
  BellRing,
  Store,
  TicketPercent,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { AppHeader } from "@/components/app/app-header";
import { Badge, Card, SectionTitle } from "@/components/ui/card";
import { signOut } from "@/actions/auth";
import { getActiveRestaurant, getProfile, getSessionUser } from "@/lib/data/restaurants";
import { isPlatformAdmin } from "@/lib/data/admin";
import { RESTAURANT_ROLE_LABEL } from "@/lib/types";
import { initials } from "@/lib/utils";

export const metadata: Metadata = { title: "Configurações" };

type Item = {
  href?: string;
  label: string;
  description: string;
  icon: LucideIcon;
  badge?: string;
};

const groups: { title: string; items: Item[] }[] = [
  {
    title: "Restaurante",
    items: [
      {
        href: "/app/configuracoes/restaurante",
        label: "Dados do restaurante",
        description: "Nome, link, contato e endereço",
        icon: Store,
      },
      {
        href: "/app/configuracoes/personalizacao",
        label: "Personalizar cardápio",
        description: "Logo, capa, cores e estilos",
        icon: Palette,
      },
      {
        // Etapa 13. Fica ao lado da personalização porque é a mesma natureza:
        // o que o cliente vê no cardápio.
        href: "/app/configuracoes/whatsapp",
        label: "WhatsApp",
        description: "Número, mensagem inicial e botão no cardápio",
        icon: MessageCircle,
      },
      {
        // Etapa 18. Fica junto do restaurante porque é configuração de
        // operação da casa: papel, perfis e impressoras físicas.
        href: "/app/configuracoes/impressao",
        label: "Impressão",
        description: "Papel térmico, perfis, impressoras e teste",
        icon: Printer,
      },
    ],
  },
  {
    // Etapa 25. "Marketing" é o nome que o dono procura para promoção — e não
    // é configuração: é ferramenta de venda, então fica em grupo próprio, no
    // topo, acima da conta.
    title: "Marketing",
    items: [
      {
        href: "/app/marketing/cupons",
        label: "Cupons",
        description: "Códigos de desconto, validade e limite de uso",
        icon: TicketPercent,
      },
      {
        href: "/app/clientes",
        label: "Clientes e fidelidade",
        description: "Quem voltou, quanto gastou e pontos",
        icon: Users,
      },
    ],
  },
  {
    title: "Avisos",
    items: [
      {
        href: "/app/notificacoes",
        label: "Notificações",
        description: "O que aparece no sino e o que pode ficar de fora",
        icon: BellRing,
      },
    ],
  },
  {
    title: "Conta",
    items: [
      {
        href: "/app/configuracoes/conta",
        label: "Sua conta",
        description: "Nome, e-mail, telefone e senha",
        icon: UserRound,
      },
      {
        href: "/app/plano",
        label: "Meu plano",
        description: "Plano atual, recursos e limites",
        icon: CreditCard,
      },
      // Etapa 19: a cobrança deixou de ser "troca registrada na hora" e virou
      // PIX com confirmação manual. A tela de pagamento tem entrada própria
      // porque é onde o dono volta para ver o status e anexar comprovante.
      {
        href: "/app/pagamento",
        label: "Pagamento do plano",
        description: "PIX, comprovante e histórico",
        icon: Receipt,
      },
      {
        label: "Ajuda e suporte",
        description: "Fale com a gente",
        icon: LifeBuoy,
        badge: "Em breve",
      },
    ],
  },
];

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/entrar?next=/app/configuracoes");

  const [profile, restaurant, isAdmin] = await Promise.all([
    getProfile(user.id),
    getActiveRestaurant(),
    isPlatformAdmin(),
  ]);

  /**
   * Quem também é administrador da plataforma ganha o atalho para o /admin.
   * O link só existe para quem tem o papel — mas isso é conveniência, não
   * controle: mesmo que a URL seja digitada por outro usuário, o layout do
   * /admin e as RPCs recusam.
   */
  const groupsWithAdmin = isAdmin
    ? [
        ...groups,
        {
          title: "Plataforma",
          items: [
            {
              href: "/admin",
              label: "Painel da plataforma",
              description: "Restaurantes, usuários, pedidos e auditoria",
              icon: ShieldCheck,
            },
          ],
        },
      ]
    : groups;

  return (
    <>
      <AppHeader title="Configurações" />

      <main className="app-shell space-y-6 px-4 pb-6 pt-5">
        {/* Cartão da conta */}
        <Card className="flex items-center gap-3.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-ink-900 text-base font-semibold text-white">
            {initials(profile?.full_name, user.email?.slice(0, 1).toUpperCase() ?? "?")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-ink-900">
              {profile?.full_name || "Sem nome"}
            </p>
            <p className="truncate text-sm text-ink-500">{user.email}</p>
          </div>
          {restaurant && (
            <Badge tone="neutral">{RESTAURANT_ROLE_LABEL[restaurant.role]}</Badge>
          )}
        </Card>

        {groupsWithAdmin.map((group) => (
          <section key={group.title} aria-labelledby={`grupo-${group.title}`}>
            <h2
              id={`grupo-${group.title}`}
              className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink-400"
            >
              {group.title}
            </h2>
            <Card className="divide-y divide-ink-100 p-0">
              {group.items.map((item) => {
                const Icon = item.icon;
                const inner = (
                  <>
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-600">
                      <Icon className="size-[1.15rem]" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[0.95rem] font-semibold text-ink-900">
                          {item.label}
                        </span>
                        {item.badge && <Badge tone="muted">{item.badge}</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink-500">
                        {item.description}
                      </span>
                    </span>
                    {item.href ? (
                      <ChevronRight className="size-4.5 shrink-0 text-ink-300" aria-hidden="true" />
                    ) : (
                      <span className="shrink-0 text-[0.65rem] font-medium uppercase tracking-wide text-ink-300">
                        Bloqueado
                      </span>
                    )}
                  </>
                );

                return item.href ? (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-50 active:bg-ink-100"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div
                    key={item.label}
                    aria-disabled="true"
                    className="flex min-h-16 items-center gap-3 px-4 py-3 opacity-60"
                  >
                    {inner}
                  </div>
                );
              })}
            </Card>
          </section>
        ))}

        <SectionTitle title="Sair da conta" />
        <form action={signOut}>
          <button
            type="submit"
            className="tap-target flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3.5 text-[0.95rem] font-semibold text-red-600 transition hover:bg-red-50 active:scale-[0.99]"
          >
            <LogOut className="size-4.5" aria-hidden="true" />
            Sair
          </button>
        </form>

        <p className="pb-2 text-center text-xs text-ink-400">
          Menuvo · versão 0.18.0 (Etapa 18)
        </p>
      </main>
    </>
  );
}
