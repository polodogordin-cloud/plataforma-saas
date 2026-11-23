/**
 * Compartilhamento e divulgação do cardápio — Etapa 23.
 *
 * Módulo **neutro** (sem React, sem `server-only`, sem DOM), pelo mesmo motivo de
 * `place-card.ts` e `qr.ts`: as regras que decidem o que vai na mensagem e em
 * qual link precisam rodar no servidor (metadados, montagem do link) e no
 * cliente (Web Share, `navigator.share`, cópia). Duas implementações divergiriam
 * no primeiro caractere diferente — e a mensagem que o dono vê na tela seria
 * diferente da que ele envia.
 *
 * ─── O que este arquivo NÃO faz ───────────────────────────────────────────
 *
 * Não publica em rede social. Instagram, Facebook e TikTok não têm URL de
 * compartilhamento pública que funcione no celular sem SDK e sem app instalado —
 * o que existe é o compartilhamento nativo do sistema operacional, que já tem
 * todas as contas do aparelho. Então o nosso papel é: montar a mensagem certa,
 * abrir o canal certo, entregar o link para copiar. Nada de "publicar
 * automaticamente no Instagram", que seria promessa falsa.
 */

/* ========================================================================== */
/* 1. Links                                                                   */
/* ========================================================================== */

export type ShareLinkKind = "menu" | "table" | "order";

/**
 * Caminhos públicos do produto.
 *
 * A URL do cardápio é `/r/{slug}`; a da mesa soma `/table/{token}`. O token é a
 * credencial — é o que permite o pedido — e por isso ele **não** é o número da
 * mesa: número muda, token não.
 */
export function menuPath(restaurantSlug: string): string {
  return `/r/${encodeURIComponent(restaurantSlug)}`;
}

export function tablePath(restaurantSlug: string, publicToken: string): string {
  return `${menuPath(restaurantSlug)}/table/${encodeURIComponent(publicToken)}`;
}

/**
 * Link do pedido.
 *
 * É o link da mesa com o número do pedido em `#`: o cardápio já lê esse número
 * do `localStorage` da própria mesa (Etapa 7), e o fragmento permite abrir a
 * mesma tela de acompanhamento de outro aparelho. Usamos `#` e não `?` de
 * propósito — o fragmento não vai ao servidor, então não vira log de acesso nem
 * quebra o cache ISR do cardápio.
 */
export function orderPath(input: {
  restaurantSlug: string;
  publicToken: string;
  orderNumber: number;
}): string {
  if (!Number.isInteger(input.orderNumber) || input.orderNumber <= 0) {
    return tablePath(input.restaurantSlug, input.publicToken);
  }
  return `${tablePath(input.restaurantSlug, input.publicToken)}#pedido-${input.orderNumber}`;
}

/** Junta origem e caminho sem barra dupla. */
export function absoluteUrl(origin: string, path: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/* ========================================================================== */
/* 2. Mensagem do WhatsApp                                                    */
/* ========================================================================== */

export type ShareMessageInput = {
  restaurantName: string;
  url: string;
  /** Chamada editável. Vazio = usa a padrão. */
  headline?: string | null;
  /** Linha extra opcional (endereço, horário, "peça sem fila"). */
  extra?: string | null;
};

/**
 * Chamada padrão.
 *
 * Curta porque no WhatsApp o que convence é o nome do restaurante e a prévia do
 * link — três parágrafos antes do link fazem a mensagem parecer corrente de
 * propaganda, e o dono não envia.
 */
export const DEFAULT_SHARE_HEADLINE = "Confira nosso cardápio digital 🍽️";

/** Tamanho máximo da chamada: cobre o que cabe no `wa.me` sem cortar o link. */
export const MAX_HEADLINE_LENGTH = 160;

/**
 * Limpa a chamada digitada pelo dono.
 *
 * O texto vai para uma URL (`?text=`), então:
 *
 *   • quebras de linha viram espaço — `encodeURIComponent` as codificaria como
 *     `%0A`, e o WhatsApp do Android mostra isso literalmente em alguns
 *     aparelhos;
 *   • sobras de espaço são colapsadas, para a mensagem não sair com buracos;
 *   • limite de 160 caracteres, contado **depois** da normalização.
 *
 * Não removemos emoji: é o que o dono usa para diferenciar a mensagem, e a URL
 * codifica cada um corretamente.
 */
export function sanitizeHeadline(value: string | null | undefined): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_HEADLINE_LENGTH ? `${text.slice(0, MAX_HEADLINE_LENGTH - 1).trimEnd()}…` : text;
}

/**
 * Mensagem completa: nome do restaurante, chamada e link.
 *
 * A ordem é deliberada — é a mesma do escopo e a que funciona no celular: quem
 * recebe vê primeiro **quem** está falando (nome), depois **por quê** (chamada)
 * e por último o que tocar (link, já com prévia do Open Graph).
 */
export function composeShareMessage(input: ShareMessageInput): string {
  const headline = sanitizeHeadline(input.headline) || DEFAULT_SHARE_HEADLINE;
  const extra = sanitizeHeadline(input.extra);

  const lines = [input.restaurantName.trim(), "", headline];
  if (extra) lines.push(extra);
  lines.push("", input.url);

  return lines.join("\n");
}

/**
 * Link `wa.me` com a mensagem pronta.
 *
 * `https://wa.me/?text=` (sem número) abre o seletor de contato do WhatsApp —
 * é o que o dono quer: escolher para quem mandar. Com número, a mensagem iria
 * para o próprio restaurante, que é o oposto de divulgar.
 *
 * `whatsapp://` não é usado: `https://` é mais confiável em desktop (abre o
 * WhatsApp Web) e em aparelho sem o app instalado (mostra a página do WhatsApp
 * em vez de um erro de esquema).
 */
export function whatsappShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** Link de conversa direta com um número (usado no botão do cardápio público). */
export function whatsappDirectUrl(phone: string, message?: string | null): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  const query = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${withCountry}${query}`;
}

/* ========================================================================== */
/* 3. Outros canais                                                           */
/* ========================================================================== */

export type ShareChannelId =
  | "native"
  | "whatsapp"
  | "copy"
  | "instagram"
  | "facebook"
  | "tiktok"
  | "google"
  | "telegram"
  | "email";

export type ShareChannel = {
  id: ShareChannelId;
  label: string;
  /** Falso quando o canal não tem URL de envio — só copiar/colar. */
  direct: boolean;
  hint: string;
};

/**
 * Canais de divulgação.
 *
 * `direct: true` significa **existe URL que abre o app/site já com o conteúdo**.
 * Só WhatsApp, Facebook (share.php), Telegram e e-mail têm isso. Instagram e
 * TikTok não têm — quem diz que tem está vendendo integração. Para esses dois, o
 * botão copia a mensagem e explica onde colar (bio, story, DM). Google não é
 * canal de envio: é onde o link aparece quando alguém procura o restaurante, e o
 * botão do Google serve para abrir a busca do próprio negócio.
 */
export const SHARE_CHANNELS: ShareChannel[] = [
  {
    id: "native",
    label: "Compartilhar",
    direct: true,
    hint: "Abre o compartilhamento do celular (WhatsApp, Instagram, Telegram, e-mail).",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    direct: true,
    hint: "Escolhe o contato e envia a mensagem pronta.",
  },
  {
    id: "copy",
    label: "Copiar link",
    direct: true,
    hint: "Copia o endereço do cardápio.",
  },
  {
    id: "instagram",
    label: "Instagram",
    direct: false,
    hint: "Copie e cole no story, na bio ou no direct.",
  },
  {
    id: "facebook",
    label: "Facebook",
    direct: true,
    hint: "Abre o Facebook com o link pronto para publicar.",
  },
  {
    id: "tiktok",
    label: "TikTok",
    direct: false,
    hint: "Copie e cole na bio ou na legenda do vídeo.",
  },
  {
    id: "google",
    label: "Google",
    direct: true,
    hint: "Abre a busca pelo seu restaurante — o cardápio aparece no resultado.",
  },
  {
    id: "telegram",
    label: "Telegram",
    direct: true,
    hint: "Abre o Telegram para escolher a conversa.",
  },
  {
    id: "email",
    label: "E-mail",
    direct: true,
    hint: "Abre o e-mail com assunto e link prontos.",
  },
];

export function getShareChannel(id: string | null | undefined): ShareChannel | null {
  return SHARE_CHANNELS.find((channel) => channel.id === id) ?? null;
}

/**
 * URL de envio do canal, ou `null` quando o canal é "copiar e colar".
 *
 * O `null` é a informação importante: é ele que faz a interface mostrar
 * "copiar" em vez de um link que não abriria nada. Um botão do Instagram que
 * aponta para `instagram.com/share` seria pior que um botão que copia.
 */
export function channelUrl(input: {
  channel: ShareChannelId | string | null | undefined;
  url: string;
  message: string;
  restaurantName: string;
}): string | null {
  const { channel, url, message } = input;

  switch (channel) {
    case "whatsapp":
      return whatsappShareUrl(message);
    case "facebook":
      // `sharer.php` é o endpoint antigo, e continua sendo o único que funciona
      // sem app-id. O `u` precisa ser só a URL: a mensagem é ignorada pelo
      // Facebook desde 2017 (só a prévia do Open Graph aparece).
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    case "telegram":
      return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(message)}`;
    case "google":
      // Busca pelo nome do restaurante, não pela URL: o dono quer ver como o
      // negócio aparece hoje (e é o único jeito de conferir o SEO na prática).
      return `https://www.google.com/search?q=${encodeURIComponent(input.restaurantName)}`;
    case "email": {
      const subject = `Cardápio de ${input.restaurantName}`;
      const body = message;
      return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }
    case "instagram":
    case "tiktok":
    case "native":
    case "copy":
    default:
      // `native` e `copy` são ações de JavaScript, não URLs.
      return null;
  }
}

/** Plataformas em que o "copiar e colar" é o caminho — usado para explicar. */
export const COPY_ONLY_CHANNELS = SHARE_CHANNELS.filter((channel) => !channel.direct && channel.id !== "native");

/* ========================================================================== */
/* 4. Web Share API                                                           */
/* ========================================================================== */

/**
 * O dispositivo tem compartilhamento nativo?
 *
 * Lê `navigator.share` quando existe. A checagem é por função, não por user
 * agent: o suporte depende do navegador **e** do contexto (só HTTPS; no
 * desktop, alguns navegadores expõem e outros não).
 */
export function supportsNativeShare(navigatorLike: { share?: unknown } | null | undefined): boolean {
  return typeof navigatorLike?.share === "function";
}

/** Dados entregues à Web Share API. */
export function nativeSharePayload(input: {
  restaurantName: string;
  url: string;
  headline?: string | null;
}) {
  return {
    title: input.restaurantName,
    text: sanitizeHeadline(input.headline) || DEFAULT_SHARE_HEADLINE,
    url: input.url,
  };
}

/**
 * Resultado do `navigator.share`.
 *
 * `AbortError` é o usuário fechando a folha de compartilhamento — não é falha, e
 * tratar como erro faria a tela dizer "não foi possível compartilhar" para quem
 * só mudou de ideia. Qualquer outro erro (NotAllowedError fora de gesto do
 * usuário, `DataError` de payload inválido) cai como falha e a interface oferece
 * o copiar.
 */
export function readShareOutcome(error: unknown): "cancelled" | "failed" {
  if (error && typeof error === "object" && "name" in error) {
    const name = String((error as { name?: unknown }).name ?? "");
    if (name === "AbortError") return "cancelled";
  }
  return "failed";
}

/* ========================================================================== */
/* 5. Texto para o Instagram/TikTok                                           */
/* ========================================================================== */

/**
 * Mensagem enxuta para colar em bio/legenda.
 *
 * Sem emoji de propaganda, sem hashtag inventada: hashtag de restaurante local
 * é escolha do dono, e a nossa sugestão errada só atrapalharia. Formato de três
 * linhas que cabe na bio do Instagram (150 caracteres).
 */
export function bioSnippet(input: { restaurantName: string; url: string }): string {
  return `${input.restaurantName}\nCardápio digital 👇\n${input.url}`;
}
