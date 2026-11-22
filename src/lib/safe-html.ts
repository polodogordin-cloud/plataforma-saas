/**
 * Serialização segura de JSON dentro de HTML — Etapa 20.
 *
 * ─── O problema ─────────────────────────────────────────────────────────────
 *
 * O cardápio público injeta dados estruturados com `dangerouslySetInnerHTML`:
 *
 *     <script type="application/ld+json"
 *       dangerouslySetInnerHTML={{ __html: JSON.stringify({ name, description }) }} />
 *
 * `JSON.stringify` **não** é escape de HTML. A sequência `</script>` dentro de
 * qualquer string encerra o elemento — o parser de HTML não sabe que está
 * dentro de uma string JSON. Então um restaurante chamado:
 *
 *     Sabor </script><img src=x onerror=alert(1)>
 *
 * produz HTML executável servido pelo **nosso** domínio, com a nossa origem:
 * tem acesso a cookie, a `localStorage` e a toda a API autenticada do visitante.
 * É XSS armazenado, plantado por quem tem conta (ou por quem convence o dono a
 * digitar o nome), disparado em quem só escaneou o QR.
 *
 * O nome do restaurante é validado só por tamanho (`min(1).max(...)`) e não
 * rejeita `<`, `>` ou `"` — e não deve: um restaurante pode legitimamente se
 * chamar "Casa & Sabor". Sanitizar o *texto* estragaria o dado. O certo é
 * escapar na *serialização*.
 *
 * ─── A correção ─────────────────────────────────────────────────────────────
 *
 * Trocar os caracteres que o parser de HTML trata como sintaxe por escapes
 * Unicode equivalentes em JSON. Em JSON, `\u003c` é exatamente o mesmo texto
 * que `<`; o consumidor (Google, Bing) lê o dado idêntico. O navegador, porém,
 * não vê mais `<` e não fecha o script.
 *
 * Módulo neutro (sem React, sem `server-only`) para ser testável direto.
 */

/**
 * Caracteres que mudam o parsing de HTML quando aparecem no texto.
 *
 * ─── Por que as aspas NÃO estão aqui ───────────────────────────────────────
 *
 * `JSON.stringify` já escapa aspas **dentro** das strings (`\"`), e as aspas de
 * fora são a sintaxe do próprio JSON. Trocá-las por `\u0022` produz
 * `{\u0022name\u0022:"..."}`, que não é JSON válido: o Google (e qualquer
 * consumidor de `application/ld+json`) falha ao ler, e o escape de defesa vira
 * defeito. Dentro de `<script>` o conteúdo é texto bruto — aspas não encerram
 * nada. Ficam de fora.
 */
const HTML_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  // Separadores de linha: U+2028/U+2029 são quebra de linha em JS antigo e
  // quebram `JSON.parse` em consumidores que não são navegador moderno.
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * `JSON.stringify` com escape para inserção em `<script>`/atributo.
 *
 * Aceita `unknown` e devolve `"null"` para o que não serializa (função, ciclo),
 * em vez de estourar dentro de um Server Component — um erro ali viraria 500 na
 * página inteira por causa de um campo opcional.
 */
export function jsonForScript(value: unknown): string {
  let json: string;

  try {
    json = JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }

  return json.replace(/[<>&]|\u2028|\u2029/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Texto vindo do banco que vai para dentro de um `dangerouslySetInnerHTML`
 * **sem** ser JSON (hoje não há caso, mas a função existe para o próximo não
 * reinventar errado).
 *
 * Escapa os cinco caracteres clássicos de HTML. Não é para HTML rico: se algum
 * dia for preciso permitir marcação, o caminho é sanitizador de HTML, não isto.
 */
export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
