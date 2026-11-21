import React from "react";
import * as ReactDOMClient from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ThemeEditor } from "@/components/theme/theme-editor";
import { MenuPreview } from "@/components/theme/menu-preview";
import { ColorField } from "@/components/theme/color-field";
import { ThemeScope } from "@/components/public/themed";
import { ProductRow } from "@/components/public/product-row";
import { PublicHeader } from "@/components/public/public-header";
import { TableActionsBar } from "@/components/public/table-actions-bar";
import { CartProvider } from "@/components/public/cart-provider";

// jsdom: `globalThis` dentro de window.eval NÃO é o window.
(window as unknown as Record<string, unknown>).__LIB__ = {
  React,
  ReactDOMClient,
  act,
  ThemeEditor,
  MenuPreview,
  ColorField,
  ThemeScope,
  ProductRow,
  PublicHeader,
  TableActionsBar,
  CartProvider,
};
