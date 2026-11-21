"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  LayoutDashboard,
  Settings2,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Navegação inferior do painel master (item 9 do escopo: mobile-first).
 *
 * Espelha a `BottomNav` do painel do restaurante de propósito — quem usa os
 * dois não precisa reaprender onde fica cada coisa. A diferença é a cor de
 * destaque: verde da marca no restaurante, quase-preto aqui, para o admin
 * saber de relance em qual contexto está.
 */

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

export const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Início", icon: LayoutDashboard, exact: true },
  { href: "/admin/restaurantes", label: "Casas", icon: Store },
  { href: "/admin/usuarios", label: "Usuários", icon: Users },
  { href: "/admin/pedidos", label: "Pedidos", icon: ClipboardList },
  { href: "/admin/configuracoes", label: "Ajustes", icon: Settings2 },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação do painel da plataforma"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-800/60 bg-ink-950/95 backdrop-blur-lg"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0px)" }}
    >
      <ul className="app-shell flex items-stretch justify-between px-1.5">
        {ADMIN_NAV_ITEMS.map((item) => {
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
                  "group flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[0.68rem] font-semibold transition-colors duration-150",
                  active ? "text-white" : "text-ink-400 hover:text-ink-200",
                )}
              >
                <span
                  className={cn(
                    "grid place-items-center rounded-lg px-3 py-1 transition-all duration-200",
                    active ? "bg-white/15" : "group-active:scale-95",
                  )}
                >
                  <Icon className={cn("size-[1.3rem]", active && "stroke-[2.4]")} aria-hidden="true" />
                </span>
                <span className="leading-none">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
