const store = () => ((globalThis as any).__THEME__ ||= { saves: [], resets: 0, uploads: [], failSave: null });

export async function saveTheme(input: unknown) {
  const s = store();
  s.saves.push(input);
  if (s.failSave) return { ok: false, error: s.failSave };
  const raw = input as Record<string, string | null>;
  return {
    ok: true,
    message: "Cardápio personalizado.",
    theme: {
      preset: raw.preset ?? null,
      primary_color: raw.primaryColor,
      secondary_color: raw.secondaryColor,
      background_color: raw.backgroundColor,
      text_color: raw.textColor,
      button_color: raw.buttonColor,
      card_style: raw.cardStyle,
      button_style: raw.buttonStyle,
      logo_url: raw.logoUrl ?? null,
      cover_url: raw.coverUrl ?? null,
    },
  };
}

export async function resetTheme() {
  const s = store();
  s.resets += 1;
  return { ok: true, message: "Tema padrão restaurado." };
}

export async function createUploadTarget(kind: string, extension: string) {
  const s = store();
  s.uploads.push({ kind, extension });
  return {
    ok: true,
    path: `rest-1/theme/${kind}-v1.${extension}`,
    publicUrl: `https://x.supabase.co/storage/v1/object/public/restaurant-assets/rest-1/theme/${kind}-v1.${extension}`,
    version: "v1",
  };
}

export async function readTheme() {
  return null;
}
