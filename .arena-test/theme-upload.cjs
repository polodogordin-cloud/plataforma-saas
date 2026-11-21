/**
 * Harness de upload de imagem — Etapa 9.
 *
 * O `optimizeImage` depende de `canvas`, que o jsdom não implementa. Então aqui
 * o canvas é injetado (o terceiro parâmetro existe exatamente para isso) e
 * verificamos o que importa:
 *
 *   • a imagem é desenhada no tamanho de saída certo (320 de logo, 1600 de capa);
 *   • o recorte é centralizado (não estica a foto);
 *   • o arquivo enviado é o otimizado, com extensão coerente;
 *   • quando não há como decodificar, sobe o original em vez de quebrar.
 */
const path = require("node:path");
const fs = require("node:fs");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "build-lib");

esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/theme-upload.ts")],
  bundle: true,
  outfile: path.join(OUT, "theme-upload.js"),
  platform: "node",
  format: "cjs",
  loader: { ".ts": "ts" },
  alias: { "@": path.join(ROOT, "src") },
  logLevel: "error",
});

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.document = dom.window.document;
globalThis.Image = dom.window.Image;

const U = require(path.join(OUT, "theme-upload.js"));

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const PNG_HEAD = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function fakeFile({ type = "image/png", size = 200_000, head = PNG_HEAD } = {}) {
  return {
    size,
    type,
    slice: () => ({ arrayBuffer: async () => head.buffer.slice(0) }),
  };
}

/** Canvas espião: registra medidas e desenho. */
function spyCanvas() {
  const calls = { drawImage: null, width: 0, height: 0, quality: null, blobType: null };
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "",
        drawImage(...args) {
          calls.drawImage = args;
        },
      };
    },
    toBlob(callback, type, quality) {
      calls.blobType = type;
      calls.quality = quality;
      calls.width = canvas.width;
      calls.height = canvas.height;
      callback(new Blob(["x"], { type: "image/webp" }));
    },
  };
  return { canvas, calls, factory: () => canvas };
}

(async () => {
  /* -------------------------------------------------- decodifica ok ---- */
  // Bitmap falso: createImageBitmap é o caminho preferido.
  globalThis.createImageBitmap = async () => ({ width: 1600, height: 900 });

  const logo = spyCanvas();
  const logoResult = await U.optimizeImage(fakeFile(), "logo", logo.factory);

  check("otimização: logo gera resultado ok", logoResult.ok === true);
  check(
    "otimização: logo é desenhada em 320×320",
    logo.calls.width === 320 && logo.calls.height === 320,
    `${logo.calls.width}×${logo.calls.height}`,
  );
  check(
    "otimização: capa 16:9 vira quadrado com recorte central",
    logo.calls.drawImage && logo.calls.drawImage[1] === 350 && logo.calls.drawImage[3] === 900,
    JSON.stringify(logo.calls.drawImage?.slice(1, 5)),
  );
  check(
    "otimização: exporta em WEBP com qualidade",
    logo.calls.blobType === "image/webp" && logo.calls.quality > 0.7,
  );
  check(
    "otimização: extensão final é webp",
    logoResult.ok && logoResult.extension === "webp",
    logoResult.ok ? logoResult.extension : "",
  );
  check(
    "otimização: relata as dimensões finais (para a UI)",
    logoResult.ok && logoResult.width === 320 && logoResult.height === 320,
  );

  const cover = spyCanvas();
  const coverResult = await U.optimizeImage(fakeFile(), "cover", cover.factory);
  check(
    "otimização: capa é desenhada em 1600×900",
    cover.calls.width === 1600 && cover.calls.height === 900,
    `${cover.calls.width}×${cover.calls.height}`,
  );
  check(
    "otimização: capa não corta uma imagem que já está em 16:9",
    cover.calls.drawImage && cover.calls.drawImage[1] === 0 && cover.calls.drawImage[2] === 0,
    JSON.stringify(cover.calls.drawImage?.slice(1, 5)),
  );
  check("otimização: resultado da capa ok", coverResult.ok === true);

  /* ------------------------------------------- arquivo inválido ------- */
  const badBuffer = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const bad = await U.optimizeImage(fakeFile({ head: badBuffer }), "logo", spyCanvas().factory);
  check(
    "otimização: arquivo que não é imagem é recusado antes do canvas",
    bad.ok === false && /não parece ser uma imagem/.test(bad.error),
  );

  const tooBig = await U.optimizeImage(fakeFile({ size: 9 * 1024 * 1024 }), "cover", spyCanvas().factory);
  check("otimização: arquivo acima de 8 MB é recusado", tooBig.ok === false);

  /* ------------------------------------------ sem canvas / sem decode - */
  globalThis.createImageBitmap = async () => ({ width: 800, height: 800 });
  const noCanvas = await U.optimizeImage(fakeFile(), "logo", () => null);
  check(
    "fallback: sem canvas, sobe o original já validado",
    noCanvas.ok === true && noCanvas.width === 0,
  );

  delete globalThis.createImageBitmap;
  const noBitmap = await U.optimizeImage(fakeFile(), "logo", spyCanvas().factory);
  check(
    "fallback: sem decodificação, sobe o original em vez de falhar",
    noBitmap.ok === true,
  );

  /* -------------------------------------------------- tamanho final --- */
  // Garante que a imagem grande NÃO é enviada: o blob vem do canvas.
  globalThis.createImageBitmap = async () => ({ width: 4000, height: 3000 });
  const tall = spyCanvas();
  const tallResult = await U.optimizeImage(fakeFile(), "cover", tall.factory);
  check(
    "desempenho: foto 4000×3000 sai em 1600×900",
    tallResult.ok && tallResult.width === 1600 && tallResult.height === 900,
  );
  check(
    "desempenho: o recorte de foto em pé é centralizado",
    tall.calls.drawImage && tall.calls.drawImage[2] > 0,
    JSON.stringify(tall.calls.drawImage?.slice(1, 5)),
  );

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `  → ${r.detail}`}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error("HARNESS ERROR:", error);
  process.exit(1);
});
