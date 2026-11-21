import React from "react";
import * as ReactDOMClient from "react-dom/client";
import { act } from "react-dom/test-utils";
import { PrintConfigForm } from "@/components/printing/print-config-form";
import { PrintTestPanel } from "@/components/printing/print-test-panel";
import { ThermalTicket } from "@/components/printing/thermal-ticket";
import { buildTicketLines, buildTestLines, PAPER_SPECS } from "@/lib/printing";
import * as printActions from "@/actions/printing";

(window as unknown as Record<string, unknown>).__LIB__ = {
  React,
  ReactDOMClient,
  act,
  PrintConfigForm,
  PrintTestPanel,
  ThermalTicket,
  buildTicketLines,
  buildTestLines,
  PAPER_SPECS,
  printActions,
};
