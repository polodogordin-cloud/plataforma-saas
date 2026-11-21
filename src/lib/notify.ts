/**
 * Som de novo pedido — módulo neutro, roda no navegador.
 *
 * Três decisões que valem documentar:
 *
 * 1. **Nenhuma requisição de áudio.** O som é sintetizado com WebAudio
 *    (dois tons curtos). Um `.mp3` de 30 KB teria de carregar antes de tocar,
 *    e o painel precisa soar no instante em que o pedido chega — sem contar o
 *    cache frio em 3G no salão.
 *
 * 2. **Navegador exige gesto do usuário.** Não dá para tocar áudio antes de
 *    qualquer interação. Por isso o painel mostra "Ativar som" e só liga o
 *    áudio depois do toque. O padrão é ligado, mas silencioso até o gesto:
 *    a preferência fica salva e vale para as próximas visitas.
 *
 * 3. **Falha em silêncio.** Se o aparelho não tocar (aba em segundo plano,
 *    política do navegador, iOS silencioso), o painel continua funcionando com
 *    destaque visual e contador. Áudio é reforço, nunca o único aviso.
 */

export const SOUND_PREF_KEY = "menuvo_orders_sound";

export type SoundState = "on" | "muted" | "blocked";

let context: AudioContext | null = null;

/** Guarda o contexto criado — um `AudioContext` por aba é o recomendado. */
function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context) return context;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!Ctor) return null;

  try {
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

/**
 * Toca o alerta de novo pedido.
 *
 * Dois "bi" ascendentes. `start`/`stop` explícitos porque oscilador sem parada
 * fica vivo na aba — num painel aberto o dia todo isso acumula.
 */
export function playNewOrderSound(): SoundState {
  const ctx = getContext();
  if (!ctx) return "blocked";

  // `suspended` = navegador bloqueou por falta de gesto.
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
    if (ctx.state === "suspended") return "blocked";
  }

  try {
    const now = ctx.currentTime;

    for (const [index, frequency] of [880, 1174.7].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + index * 0.16;
      const end = start + 0.14;

      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, start);
      // Envelope curto: sem isso o corte do `stop` estala no alto-falante.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);

      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }

    return "on";
  } catch {
    return "blocked";
  }
}

/**
 * "Destrava" o áudio no primeiro gesto do usuário.
 *
 * Chamado no clique de "Ativar som": o gesto é o que o navegador exige para
 * permitir som depois.
 */
export async function primeAudio(): Promise<SoundState> {
  const ctx = getContext();
  if (!ctx) return "blocked";
  try {
    if (ctx.state === "suspended") await ctx.resume();
    return ctx.state === "running" ? "on" : "blocked";
  } catch {
    return "blocked";
  }
}

/** Preferência salva (padrão: ligado). */
export function readSoundPreference(): "on" | "muted" {
  if (typeof window === "undefined") return "on";
  try {
    return window.localStorage.getItem(SOUND_PREF_KEY) === "muted" ? "muted" : "on";
  } catch {
    return "on";
  }
}

export function saveSoundPreference(value: "on" | "muted"): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOUND_PREF_KEY, value);
  } catch {
    /* modo privado: a sessão fica sem memória de preferência */
  }
}

/**
 * Vibração curta, quando o aparelho suporta.
 *
 * Mesmo raciocínio do som: reforço para quem está com o celular no bolso.
 * `navigator.vibrate` não existe no iOS — não é erro, é ausência.
 */
export function vibrateNewOrder(): void {
  if (typeof navigator === "undefined") return;
  try {
    navigator.vibrate?.([90, 60, 90]);
  } catch {
    /* alguns navegadores lançam mesmo declarando suporte */
  }
}
