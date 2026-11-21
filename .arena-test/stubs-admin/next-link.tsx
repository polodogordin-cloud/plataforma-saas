// Stub de `next/link` para renderização estática: um <a> simples serve para
// conferir o href que sai no HTML.
import React from "react";

export default function Link({
  href,
  children,
  ...props
}: {
  href: string;
  children: React.ReactNode;
  [key: string]: unknown;
}) {
  return React.createElement("a", { href, ...props }, children);
}
