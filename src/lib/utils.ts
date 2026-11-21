/** Utilitário simples de classes condicionais (sem dependência extra). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function initials(name: string | null | undefined, fallback = "?"): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || fallback;
}

export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] ?? "";
}

export function formatDate(iso: string, locale = "pt-BR"): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
