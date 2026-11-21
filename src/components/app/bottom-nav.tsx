"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
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
  { href: "/app/configuracoes", label: "Ajustes", icon: Settings },
];

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
      <ul className="app-shell flex items-stretch justify-between px-1.5">
        {NAV_ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[0.7rem] font-semibold transition-colors duration-150",
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
                <span className="leading-none">{item.label}</span>
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
