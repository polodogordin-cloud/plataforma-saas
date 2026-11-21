"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
  ChartNoAxesColumn,
  ClipboardList,
  Home,
  Settings,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Rota raiz: só fica ativa em match exato. */
  exact?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/app", label: "Início", icon: Home, exact: true },
  { href: "/app/cardapio", label: "Cardápio", icon: BookOpenText },
  { href: "/app/mesas", label: "Mesas", icon: UtensilsCrossed },
  { href: "/app/pedidos", label: "Pedidos", icon: ClipboardList },
  // Etapa 16: relatórios ganharam aba própria. "Relatórios" é o nome que o dono
  // procura (e é o título da página), então fica melhor aqui que escondido em
  // Configurações — é a tela que ele abre sem estar procurando nada.
  { href: "/app/analytics", label: "Relatórios", icon: ChartNoAxesColumn },
  // "Configurações" é o nome que o usuário procura (o mesmo da rota). Cabe em
  // 320px porque o rótulo usa tamanho fluido — ver `LABEL_SIZE` abaixo.
  { href: "/app/configuracoes", label: "Configurações", icon: Settings },
];

/**
 * Tamanho do rótulo da navegação.
 *
 * **Seis abas desde a etapa 16.** Em 320px cada item fica com ~53px de slot, e
 * "Configurações" (13 caracteres) é o rótulo mais largo — é ele que decide se o
 * layout cabe.
 *
 * A primeira versão desta constante partiu de uma estimativa ("~0.55 em por
 * caractere") e errou por ~2px. Medindo as larguras reais de glifo com as
 * tabelas `hmtx` da fonte:
 *
 *   • Noto Sans, `2.3vw` em 320px (7.36px): "Configurações" mede 47.6px contra
 *     52.7px de slot — cabe com 5px de folga (menos para semibold, ~1px);
 *   • DejaVu Sans **Bold** — ~12% mais largo que SF Pro/Roboto, usado como pior
 *     caso: 56.9px, estoura 4px no mesmo ponto.
 *
 * Ou seja: com a fonte de sistema a versão anterior já cabia, mas com ~1px de
 * margem, e a fonte é escolhida pelo aparelho. Não se controla.
 *
 * Duas saídas foram consideradas e uma foi escolhida:
 *
 *   • encurtar o rótulo para "Ajustes" — foi o que se fez antes, e o usuário
 *     deixou de achar a tela (o nome não casa com a rota nem com o que ele
 *     procura);
 *   • reduzir o tamanho fluido — escolhida. `2.15vw` acompanha a largura e o
 *     `clamp` trava entre 7.2px (320px) e 9.9px (430px+). Em Noto Sans isso
 *     leva "Configurações" a 45.5px em 320px — 7px de folga; em DejaVu Bold a
 *     54.5px, 1.8px além do slot, e é aí que `truncate` entra.
 *
 * A 7.2px o rótulo é pequeno, e é um trade-off consciente: 320px é o iPhone SE
 * de 1ª geração; de 360px (Android comum) para cima o tamanho sobe para 7.7px
 * e o rótulo respira. O alvo de toque continua 56px de altura, que é o que
 * importa para o dedo — o texto pequeno é lido, não mirado. Cada aba mantém
 * `aria-label` implícito pelo texto, então leitor de tela não depende do
 * tamanho da fonte.
 *
 * E, como o tamanho da fonte do aparelho não está sob nosso controle (usuário
 * pode aumentar a fonte do sistema), a aba ganha `min-w-0` + reticências: se o
 * rótulo não couber, ele trunca. Truncar é feio; empurrar a barra para fora da
 * tela e criar rolagem horizontal no app inteiro é pior.
 */
const LABEL_SIZE = "text-[clamp(0.45rem,2.15vw,0.62rem)]";

/**
 * Navegação inferior fixa — pensada para uso com uma mão.
 * Alvos de 56px+, ícone + rótulo, respeitando a área segura do iPhone.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200/80 bg-white/95 backdrop-blur-lg"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)" }}
    >
      <ul className="app-shell flex items-stretch justify-between px-0.5">
        {NAV_ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-xl px-0 py-2 font-semibold tracking-tight transition-colors duration-150",
                  LABEL_SIZE,
                  active ? "text-brand-700" : "text-ink-400 hover:text-ink-600",
                )}
              >
                <span
                  className={cn(
                    "grid place-items-center rounded-lg transition-all duration-200 ease-[var(--ease-out-soft)]",
                    active ? "bg-brand-50 px-3 py-1" : "px-3 py-1 group-active:scale-95",
                  )}
                >
                  <Icon
                    className={cn("size-[1.35rem]", active && "stroke-[2.4]")}
                    aria-hidden="true"
                  />
                </span>
                <span className="max-w-full truncate leading-none">{item.label}</span>
                {active && (
                  <span
                    className="absolute -top-px h-0.5 w-8 rounded-full bg-brand-600"
                    aria-hidden="true"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
