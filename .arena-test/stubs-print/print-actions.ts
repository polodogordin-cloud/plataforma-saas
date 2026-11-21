/**
 * Stub das Server Actions de impressão para o harness de UI.
 *
 * O harness roda fora do Next: aqui as ações só registram a chamada e devolvem
 * o config que o teste montou. Isso permite provar que a tela reage ao
 * resultado do servidor (config nova, erro de permissão) sem banco.
 */
export type Config = {
  settings: {
    mode: "manual" | "auto";
    default_paper_width: "58" | "80";
    print_orders: boolean;
    print_tickets: boolean;
    print_kitchen: boolean;
    print_counter: boolean;
    copies: number;
    footer_note: string | null;
  };
  profiles: unknown[];
  printers: unknown[];
  can_configure: boolean;
};

export const calls: Array<{ name: string; input: unknown }> = [];
let nextConfig: Config | null = null;
let nextError: string | null = null;

export function __reset(): void {
  calls.length = 0;
  nextConfig = null;
  nextError = null;
}

export function __setConfig(config: Config): void {
  nextConfig = config;
}

export function __failWith(message: string | null): void {
  nextError = message;
}

async function respond(name: string, input: unknown) {
  calls.push({ name, input });
  if (nextError) return { ok: false as const, error: nextError };
  return { ok: true as const, data: nextConfig as Config, message: "Salvo." };
}

export async function savePrintSettings(input: unknown) {
  return respond("savePrintSettings", input);
}

export async function savePrintProfile(input: unknown) {
  return respond("savePrintProfile", input);
}

export async function deletePrintProfile(id: string) {
  return respond("deletePrintProfile", id);
}

export async function seedPrintProfiles() {
  return respond("seedPrintProfiles", null);
}

export async function savePrinter(input: unknown) {
  return respond("savePrinter", input);
}

export async function deletePrinter(id: string) {
  return respond("deletePrinter", id);
}

export async function logPrintJob(input: unknown) {
  calls.push({ name: "logPrintJob", input });
  return { ok: true };
}

export async function fetchPrintOrder() {
  return { ok: false as const, error: "não usado na UI" };
}
