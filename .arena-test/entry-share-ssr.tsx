import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShareHub } from "@/components/share/share-hub";

/**
 * Entrada de renderização estática da divulgação (Etapa 23).
 *
 * `ShareHub` é client component, mas o primeiro render (servidor) é o que o dono
 * vê antes de qualquer interação — e é onde os bugs de layout mobile aparecem:
 * link longo estourando o card, ação sem rótulo, botão que não existe quando o
 * negócio está despublicado. Renderizar aqui com `react-dom/server` verifica
 * exatamente isso sem navegador.
 */

const baseProps = {
  restaurantName: "Famintos & Cia",
  restaurantSlug: "famintos",
  logoUrl: null as string | null,
  headline: "Peça sem fila pelo celular" as string | null,
  isPublished: true,
  origin: "https://menuvo.app",
  tables: [
    { id: "t1", name: "Mesa 01", code: "M01", publicToken: "TOKENA123", active: true },
    { id: "t2", name: "Mesa 02", code: "M02", publicToken: "TOKENB456", active: false },
  ],
  orders: [{ id: "o1", orderNumber: 1042, tableName: "Mesa 01", tableId: "t1", tablePublicToken: "TOKENA123" }],
  canEdit: true,
};

export const noop = () => {};

export function renderHub(overrides: Partial<typeof baseProps> = {}) {
  return renderToStaticMarkup(React.createElement(ShareHub, { ...baseProps, ...overrides }));
}

export function renderUnpublished() {
  return renderToStaticMarkup(React.createElement(ShareHub, { ...baseProps, isPublished: false }));
}

export function renderNoTables() {
  return renderToStaticMarkup(
    React.createElement(ShareHub, { ...baseProps, tables: [], orders: [] }),
  );
}

export function renderReadOnly() {
  return renderToStaticMarkup(React.createElement(ShareHub, { ...baseProps, canEdit: false }));
}
