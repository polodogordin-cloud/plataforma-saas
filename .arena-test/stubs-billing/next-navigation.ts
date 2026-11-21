// Stub mínimo de `next/navigation` para o harness.
/**
 * Chamadas de navegação do teste.
 *
 * O array fica em `window` (e não em um módulo) porque `useRouter()` é chamado
 * a cada render: se cada render tivesse o próprio acumulador, o harness não
 * conseguiria zerar o mesmo que a tela usa.
 */
export const refreshed: string[] = [];

function log(entry: string) {
  if (typeof window === "undefined") return;
  const target = ((window as unknown as { __nav?: string[] }).__nav ??= []);
  target.push(entry);
}

export function useRouter() {
  return {
    refresh: () => log("refresh"),
    push: (href: string) => log(`push:${href}`),
    replace: (href: string) => log(`replace:${href}`),
    back: () => log("back"),
    prefetch: () => {},
    forward: () => {},
  };
}

export function usePathname() {
  return "/admin";
}

export function useSearchParams() {
  return new URLSearchParams();
}

export function redirect() {}

export function notFound() {}
