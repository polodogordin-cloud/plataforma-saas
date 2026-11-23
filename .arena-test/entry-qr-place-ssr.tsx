import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlacePreview } from "@/components/tables/place-editor";
import {
  DEFAULT_PLACE_STYLE,
  PLACE_FORMAT_IDS,
  PLACE_TEMPLATES,
  type PlaceStyle,
} from "@/lib/place-card";

/**
 * Entrada de renderização estática do gerador de plaquinhas (Etapa 22).
 *
 * Só o `PlacePreview` entra aqui: ele é puro (props → SVG) e é justamente o que
 * o dono aprova antes de imprimir. Os demais componentes usam `useState`,
 * `useTransition` e o roteador; renderizá-los exigiria simular o roteador inteiro
 * sem verificar nada novo — a parte de interação é coberta por análise de fonte
 * em `qr-place-security.cjs`.
 */

export const noop = () => {};

export function renderPreview(style: Partial<PlaceStyle> = {}) {
  return renderToStaticMarkup(
    React.createElement(PlacePreview, {
      style: { ...DEFAULT_PLACE_STYLE, ...style },
      restaurantName: "Famintos & Cia",
      tableName: "Mesa 01",
      logoUrl: null,
    }),
  );
}

export function renderPreviewWithLogo(style: Partial<PlaceStyle> = {}) {
  return renderToStaticMarkup(
    React.createElement(PlacePreview, {
      style: { ...DEFAULT_PLACE_STYLE, showLogo: true, ...style },
      restaurantName: "Famintos",
      tableName: "Mesa 07 — Varanda",
      logoUrl: "https://exemplo.test/logo.png",
    }),
  );
}

export const formats = PLACE_FORMAT_IDS;
export const templates = PLACE_TEMPLATES;
