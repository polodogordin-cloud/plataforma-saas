"use client";

import { createContext, useContext } from "react";
import { NotificationBell } from "@/components/notifications/notification-bell";

/**
 * Slots do sino — Etapa 26.
 *
 * O cabeçalho (`AppHeader`) é Server Component e aparece em 25 telas. Passar
 * `bell={{ userId, ... }}` em cada uma seria 25 oportunidades de esquecer — e a
 * tela onde esquecer é justamente a que o dono mais abre.
 *
 * Então o layout de `/app` envolve as páginas num provider (que recebe do
 * servidor o id do usuário, o nome da casa e o fuso) e o cabeçalho renderiza um
 * slot que lê esse contexto. Fora de `/app` (impressão, preview de tema) não há
 * provider e o slot não desenha nada — nenhum canal de tempo real órfão.
 */
type BellContextValue = {
  userId: string;
  restaurantName: string | null;
  timeZone: string | null;
  initialUnread: number;
} | null;

const BellContext = createContext<BellContextValue>(null);

export function NotificationBellProvider({
  userId,
  restaurantName,
  timeZone,
  initialUnread = 0,
  children,
}: {
  userId: string;
  restaurantName?: string | null;
  timeZone?: string | null;
  /** Contagem lida no servidor — o sino já nasce com o número certo. */
  initialUnread?: number;
  children: React.ReactNode;
}) {
  return (
    <BellContext.Provider
      value={{
        userId,
        restaurantName: restaurantName ?? null,
        timeZone: timeZone ?? null,
        initialUnread: Number.isFinite(initialUnread) ? Math.max(0, initialUnread) : 0,
      }}
    >
      {children}
    </BellContext.Provider>
  );
}

/** Desenhado pelo `AppHeader`. Sem provider (ou sem usuário), não aparece. */
export function NotificationBellSlot() {
  const value = useContext(BellContext);
  if (!value?.userId) return null;

  return (
    <NotificationBell
      userId={value.userId}
      restaurantName={value.restaurantName}
      timeZone={value.timeZone}
      initialUnread={value.initialUnread}
    />
  );
}
