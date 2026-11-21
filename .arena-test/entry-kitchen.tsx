import React from "react";
import * as ReactDOMClient from "react-dom/client";
import { act } from "react-dom/test-utils";
import { KitchenCard } from "@/components/kitchen/kitchen-card";
import { KitchenBoard } from "@/components/kitchen/kitchen-board";
// Mesma instância do módulo que o bundle usa: importar o stub por fora faria o
// harness ler um segundo módulo e `calls` viria sempre vazio.
import * as kitchenActions from "@/actions/kitchen";

(window as unknown as Record<string, unknown>).__LIB__ = {
  React,
  ReactDOMClient,
  act,
  KitchenCard,
  KitchenBoard,
  kitchenActions,
};
