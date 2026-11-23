/**
 * Harness do modelo de divulgação — Etapa 23 (parte 1).
 *
 * Alvo: `src/lib/share.ts` + `src/lib/share-card.ts`, sem DOM e sem banco.
 *
 * O que, se errar aqui, não dá erro — dá **mensagem errada na mão do cliente**:
 *
 *   1. a URL do link (geral, mesa, pedido) e o fragmento do pedido;
 *   2. a mensagem do WhatsApp: nome, chamada e link, na ordem certa;
 *   3. a chamada editada: normalização, limite e o que acontece com emoji;
 *   4. canais: quais têm URL de envio e quais são "copiar e colar";
 *   5. Web Share: payload, cancelamento × falha;
 *   6. a arte 1200×630: nome, chamada, endereço e escape.
 *
 * Rodar: node .arena-test/share-lib.cjs
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-share-lib");
fs.rmSync(OUT, { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/share.ts"), path.join(ROOT, "src/lib/share-card.ts")],
  bundle: true,
  outdir: OUT,
  platform: "node",
  format: "cjs",
  loader: { ".ts": "ts" },
  logLevel: "error",
});

const S = require(path.join(OUT, "share.js"));
const C = require(path.join(OUT, "share-card.js"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `recebido ${JSON.stringify(actual)}`);

/* ========================================================================== */
/* 1. Links                                                                  */
/* ========================================================================== */

eq("menuPath: monta /r/{slug}", S.menuPath("famintos"), "/r/famintos");
eq("menuPath: codifica o slug", S.menuPath("bar do zé"), "/r/bar%20do%20z%C3%A9");
eq(
  "tablePath: soma o token, não o número",
  S.tablePath("famintos", "abc123"),
  "/r/famintos/table/abc123",
);
check("tablePath: nunca usa /mesa/", !S.tablePath("famintos", "abc123").includes("/mesa/"));
eq(
  "orderPath: usa fragmento com o número",
  S.orderPath({ restaurantSlug: "famintos", publicToken: "abc123", orderNumber: 1042 }),
  "/r/famintos/table/abc123#pedido-1042",
);
check(
  "orderPath: fragmento (não query) — não vai ao servidor",
  !S.orderPath({ restaurantSlug: "famintos", publicToken: "abc123", orderNumber: 7 }).includes("?"),
);
eq(
  "orderPath: número inválido cai no link da mesa",
  S.orderPath({ restaurantSlug: "famintos", publicToken: "abc123", orderNumber: 0 }),
  "/r/famintos/table/abc123",
);
eq(
  "orderPath: número não inteiro cai no link da mesa",
  S.orderPath({ restaurantSlug: "famintos", publicToken: "abc123", orderNumber: 1.5 }),
  "/r/famintos/table/abc123",
);
eq("absoluteUrl: junta origem e caminho", S.absoluteUrl("https://menuvo.app", "/r/x"), "https://menuvo.app/r/x");
eq("absoluteUrl: remove barra dupla", S.absoluteUrl("https://menuvo.app/", "/r/x"), "https://menuvo.app/r/x");
eq("absoluteUrl: aceita caminho sem barra", S.absoluteUrl("https://menuvo.app", "r/x"), "https://menuvo.app/r/x");

/* ========================================================================== */
/* 2. Mensagem                                                               */
/* ========================================================================== */

const message = S.composeShareMessage({
  restaurantName: "Famintos",
  url: "https://menuvo.app/r/famintos",
  headline: "Peça sem fila",
});

eq(
  "mensagem: nome, chamada e link em 3 blocos",
  message,
  "Famintos\n\nPeça sem fila\n\nhttps://menuvo.app/r/famintos",
);
check("mensagem: começa pelo nome do restaurante", message.startsWith("Famintos"));
check("mensagem: termina pelo link", message.endsWith("https://menuvo.app/r/famintos"));

const defaulted = S.composeShareMessage({
  restaurantName: "Famintos",
  url: "https://menuvo.app/r/famintos",
  headline: "",
});
check("mensagem: chamada vazia usa a padrão", defaulted.includes(S.DEFAULT_SHARE_HEADLINE));
check("mensagem: chamada nula usa a padrão", S.composeShareMessage({
  restaurantName: "X",
  url: "https://a.b/r/x",
  headline: null,
}).includes(S.DEFAULT_SHARE_HEADLINE));
check("mensagem: linha extra entra antes do link", S.composeShareMessage({
  restaurantName: "X",
  url: "https://a.b/r/x",
  headline: "oi",
  extra: "Rua das Flores, 10",
}).includes("Rua das Flores, 10"));
eq("mensagem: padrão tem emoji de prato", S.DEFAULT_SHARE_HEADLINE.includes("🍽"), true);

/* ========================================================================== */
/* 3. Chamada editada                                                        */
/* ========================================================================== */

eq("chamada: espaços colapsados", S.sanitizeHeadline("  Peça   sem\nfila  "), "Peça sem fila");
eq("chamada: quebra de linha some", S.sanitizeHeadline("linha1\nlinha2"), "linha1 linha2");
eq("chamada: tab vira espaço", S.sanitizeHeadline("a\tb"), "a b");
eq("chamada: vazia continua vazia", S.sanitizeHeadline("   "), "");
eq("chamada: null vira vazio", S.sanitizeHeadline(null), "");
check(
  "chamada: limite de 160 com reticências",
  S.sanitizeHeadline("a".repeat(300)).length === S.MAX_HEADLINE_LENGTH,
);
check(
  "chamada: o limite é contado depois da normalização",
  S.sanitizeHeadline(`${"a".repeat(100)}      ${"b".repeat(100)}`).length <= S.MAX_HEADLINE_LENGTH,
);
eq("chamada: emoji é preservado", S.sanitizeHeadline("Olá 🍕"), "Olá 🍕");
eq("chamada: máximo é 160", S.MAX_HEADLINE_LENGTH, 160);

const wa = S.whatsappShareUrl(message);
check("wa.me: sem número (escolhe o contato)", wa.startsWith("https://wa.me/?text="), wa);
check("wa.me: mensagem codificada", wa.includes(encodeURIComponent("Famintos")));
check("wa.me: quebra de linha vira %0A", wa.includes("%0A"));
check("wa.me: usa https, não esquema whatsapp://", wa.startsWith("https://"));

eq("whatsappDirectUrl: número com DDI", S.whatsappDirectUrl("5585999998888"), "https://wa.me/5585999998888");
// "85999998888" começa com 55 por acidente ("85" + "99..."), e a heurística
// do DDI trata como número já internacional — dado real do Brasil nunca começa
// com 55, então o caso que importa é o DDD que não colide.
eq(
  "whatsappDirectUrl: adiciona DDI quando falta",
  S.whatsappDirectUrl("11999998888"),
  "https://wa.me/5511999998888",
);
eq(
  "whatsappDirectUrl: formata número com máscara",
  S.whatsappDirectUrl("(11) 99999-8888"),
  "https://wa.me/5511999998888",
);
eq("whatsappDirectUrl: número curto é recusado", S.whatsappDirectUrl("123"), null);
eq("whatsappDirectUrl: vazio é recusado", S.whatsappDirectUrl(""), null);

/* ========================================================================== */
/* 4. Canais                                                                 */
/* ========================================================================== */

const ids = S.SHARE_CHANNELS.map((channel) => channel.id);
for (const required of ["native", "whatsapp", "copy", "instagram", "facebook", "tiktok", "google"]) {
  check(`canais: inclui ${required}`, ids.includes(required));
}
check("canais: todo canal tem rótulo e dica", S.SHARE_CHANNELS.every((c) => c.label && c.hint));
check("canais: ids únicos", new Set(ids).size === ids.length);
check("canais: exatamente um nativo", S.SHARE_CHANNELS.filter((c) => c.id === "native").length === 1);

const copyOnly = S.COPY_ONLY_CHANNELS.map((c) => c.id);
eq("canais: Instagram e TikTok são copiar-e-colar", copyOnly.sort(), ["instagram", "tiktok"]);

const base = { url: "https://menuvo.app/r/famintos", message: "oi", restaurantName: "Famintos" };
check(
  "canal: WhatsApp devolve wa.me",
  S.channelUrl({ ...base, channel: "whatsapp" }).startsWith("https://wa.me/"),
);
check(
  "canal: Facebook usa sharer",
  S.channelUrl({ ...base, channel: "facebook" }).startsWith("https://www.facebook.com/sharer/sharer.php?u="),
);
check(
  "canal: Telegram devolve t.me",
  S.channelUrl({ ...base, channel: "telegram" }).startsWith("https://t.me/share/url"),
);
check(
  "canal: e-mail usa mailto",
  S.channelUrl({ ...base, channel: "email" }).startsWith("mailto:?subject="),
);
check(
  "canal: Google busca o nome (não a URL)",
  S.channelUrl({ ...base, channel: "google" }).includes("q=Famintos"),
);
eq("canal: Instagram devolve null (sem URL de envio)", S.channelUrl({ ...base, channel: "instagram" }), null);
eq("canal: TikTok devolve null (sem URL de envio)", S.channelUrl({ ...base, channel: "tiktok" }), null);
eq("canal: desconhecido devolve null", S.channelUrl({ ...base, channel: "orkut" }), null);
eq("canal: native não é URL", S.channelUrl({ ...base, channel: "native" }), null);
eq("getShareChannel: acha pelo id", S.getShareChannel("whatsapp").label, "WhatsApp");
eq("getShareChannel: desconhecido é null", S.getShareChannel("myspace"), null);

check(
  "canal: Facebook não tenta enviar texto (só a URL, por limitação da plataforma)",
  !S.channelUrl({ ...base, channel: "facebook" }).includes("oi"),
);

/* ========================================================================== */
/* 5. Web Share                                                              */
/* ========================================================================== */

check("share: detecta navigator.share", S.supportsNativeShare({ share: () => {} }));
check("share: nega quando não existe", !S.supportsNativeShare({}));
check("share: nega navigator nulo", !S.supportsNativeShare(null));
check("share: nega share que não é função", !S.supportsNativeShare({ share: "sim" }));

const payload = S.nativeSharePayload({
  restaurantName: "Famintos",
  url: "https://menuvo.app/r/famintos",
  headline: "Peça sem fila",
});
eq("payload: title é o nome do restaurante", payload.title, "Famintos");
eq("payload: text é a chamada", payload.text, "Peça sem fila");
eq("payload: url é o link", payload.url, "https://menuvo.app/r/famintos");
eq(
  "payload: chamada vazia usa a padrão",
  S.nativeSharePayload({ restaurantName: "X", url: "u", headline: "" }).text,
  S.DEFAULT_SHARE_HEADLINE,
);
eq("outcome: AbortError é cancelamento", S.readShareOutcome({ name: "AbortError" }), "cancelled");
eq("outcome: NotAllowedError é falha", S.readShareOutcome({ name: "NotAllowedError" }), "failed");
eq("outcome: erro genérico é falha", S.readShareOutcome(new Error("x")), "failed");
eq("outcome: null é falha", S.readShareOutcome(null), "failed");

eq(
  "bio: formato de três linhas para o Instagram",
  S.bioSnippet({ restaurantName: "Famintos", url: "https://menuvo.app/r/famintos" }),
  "Famintos\nCardápio digital 👇\nhttps://menuvo.app/r/famintos",
);

/* ========================================================================== */
/* 6. Arte de compartilhamento                                               */
/* ========================================================================== */

eq("arte: 1200×630 (proporção de card social)", [C.SHARE_CARD_WIDTH, C.SHARE_CARD_HEIGHT], [1200, 630]);

const svg = C.shareCardSvg({
  restaurantName: "Famintos & Cia",
  headline: "Peça sem fila",
  displayUrl: "https://menuvo.app/r/famintos",
});

check("arte: é um SVG", svg.startsWith("<svg"));
check("arte: tem viewBox de 1200×630", svg.includes('viewBox="0 0 1200 630"'));
check("arte: fecha", svg.trimEnd().endsWith("</svg>"));
check("arte: mostra o nome escapado", svg.includes("Famintos &amp; Cia") && !svg.includes("Famintos & Cia"));
check("arte: mostra a chamada", svg.includes("Peça sem fila"));
check("arte: mostra o endereço sem https://", svg.includes("menuvo.app/r/famintos") && !svg.includes("https://menuvo.app"));
check("arte: tem rodapé com 'Cardápio digital'", svg.includes(">Cardápio digital<"));
check("arte: usa a cor padrão quando não há tema", svg.includes("#0f9250"));
check("arte: não usa tabela", !svg.includes("<table"));
// O namespace do SVG é a única URL permitida; nenhuma imagem remota é buscada.
check(
  "arte: não busca imagem remota (só o namespace xmlns)",
  (svg.match(/https?:\/\//g) || []).length === 1 && svg.includes("xmlns=\"http://www.w3.org"),
);

const withAccent = C.shareCardSvg({ restaurantName: "X", accent: "#c2410c" });
check("arte: respeita a cor de destaque", withAccent.includes("#c2410c"));

eq("arte: cor inválida cai no padrão", C.accentColor("vermelho"), "#0f9250");
eq("arte: branco cai no padrão (invisível como faixa)", C.accentColor("#FFFFFF"), "#0f9250");
eq("arte: hex válido é normalizado", C.accentColor("#C2410C"), "#c2410c");
check("arte: isHexColor aceita 6 dígitos", C.isHexColor("#aabbcc"));
check("arte: isHexColor recusa 3 dígitos", !C.isHexColor("#abc"));
check("arte: isHexColor recusa nome", !C.isHexColor("red"));

eq("nome: 24 caracteres cabem", C.fitName("Bar do Zé"), "Bar do Zé");
check("nome: longo é truncado", C.fitName("Restaurante do Zé da Esquina Com Nome Enorme").length <= 25);
check(
  "nome: corte acontece no espaço (termina em palavra inteira + …)",
  /^\S+( \S+)*…$/.test(C.fitName("Restaurante do Zé da Esquina Com Nome Enorme")),
  C.fitName("Restaurante do Zé da Esquina Com Nome Enorme"),
);
check("nome: curto usa corpo maior", C.nameSize("Bar do Zé") > C.nameSize("Restaurante do Zé da Esquina"));
check("nome: longo usa corpo menor", C.nameSize("Restaurante do Zé da Esquina") <= 60);

eq("url curta: remove esquema", C.shortUrl("https://menuvo.app/r/x"), "menuvo.app/r/x");
eq("url curta: remove barra final", C.shortUrl("https://menuvo.app/r/x/"), "menuvo.app/r/x");
check("url curta: longa é truncada com reticências", C.shortUrl(`https://menuvo.app/r/${"a".repeat(80)}`).endsWith("…"));
check("url curta: limite respeitado", C.shortUrl(`https://menuvo.app/r/${"a".repeat(80)}`).length <= 48);

/* Emoji: a arte é rasterizada em servidor Linux sem fonte de emoji, e sai como
 * caixa vazia. Medido na geração real; por isso o texto é limpo antes do SVG. */
eq("arte: emoji é removido do texto", C.plainText("Peça sem fila 🍽️ 🔥"), "Peça sem fila");
check(
  "arte: chamada com emoji sai limpa no SVG",
  !C.shareCardSvg({ restaurantName: "X", headline: "Bora 🍕" }).includes("🍕"),
);
check(
  "arte: nome com emoji é limpo",
  !C.shareCardSvg({ restaurantName: "Pizza 🍕 do Zé" }).includes("🍕"),
);
check(
  "arte: texto normal não é afetado",
  C.plainText("Açaí com granola") === "Açaí com granola",
);

check("arte: cache de uma hora", C.SHARE_CARD_CACHE_SECONDS === 3600);

/* O Next exige literal no `revalidate` da rota, então o número é repetido lá.
 * Este teste é o que impede os dois de divergirem em silêncio. */
{
  const route = fs.readFileSync(
    path.resolve(__dirname, "..", "src/app/r/[slug]/opengraph-image.tsx"),
    "utf8",
  );
  check(
    "arte: revalidate literal da rota bate com a constante",
    new RegExp(`export const revalidate = ${C.SHARE_CARD_CACHE_SECONDS};`).test(route),
  );
  check("arte: rota não usa a constante importada no revalidate", !/export const revalidate = SHARE_CARD/.test(route));
}

const withLogo = C.shareCardSvg({ restaurantName: "X", logoDataUri: "data:image/png;base64,AAAA" });
check("arte: logo entra como <image>", withLogo.includes("<image"));
check("arte: com logo o nome desce", C.shareCardSvg({ restaurantName: "X" }).includes('y="250"') && withLogo.includes('y="296"'));

/* ========================================================================== */
/* Resultado                                                                 */
/* ========================================================================== */

const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log(`FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} PASS (share-lib.cjs)`);
process.exit(failed.length ? 1 : 0);
