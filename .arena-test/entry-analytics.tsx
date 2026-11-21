import React from "react";
import * as ReactDOMClient from "react-dom/client";
import { act } from "react-dom/test-utils";
import { DailyBars, HoursBars, RankedBars, TrendArea } from "@/components/analytics/charts";
import { AnalyticsMetric, MetricRow } from "@/components/analytics/metric-card";
import { PaymentSection } from "@/components/orders/payment-section";

(window as unknown as Record<string, unknown>).__LIB__ = {
  React,
  ReactDOMClient,
  act,
  DailyBars,
  HoursBars,
  RankedBars,
  TrendArea,
  AnalyticsMetric,
  MetricRow,
  PaymentSection,
};
