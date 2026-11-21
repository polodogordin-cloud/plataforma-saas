/**
 * Upload de imagens do tema — Etapa 9.
 *
 * Módulo neutro (sem React, sem `server-only`): as regras de arquivo são
 * testáveis em Node e o upload roda no navegador.
 *
 * ─── Por que redimensionar no cliente ───────────────────────────────────────
 *
 * Foto de celular tem 12 MP e 4 MB. Mandar isso para o cardápio é o pior
 * cenário do item 11 do escopo: o cliente no 3G do salão baixa 4 MB para ver um
 * logo de 64 px. Antes de subir, o arquivo passa por um `canvas` e sai com o
 * tamanho que a tela realmente usa, em WebP quando o navegador suporta.
 *
 * ─── Por que não confiar no `accept` do input ───────────────────────────────
 *
 * `accept="image/*"` é dica de interface, não validação. Quem quiser manda um
 * .exe renomeado. Validamos tipo e assinatura (magic bytes) aqui, o bucket
 * também filtra por MIME, e a RPC no banco só aceita caminho do próprio tenant.
 * Três camadas independentes.
 */

export type UploadKind = "logo" | "cover";

/** Limite do arquivo **original** — acima disso nem tentamos decodificar. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

export type AcceptedMime = "image/png" | "image/jpeg" | "image/webp";

export const ACCEPTED_MIME: AcceptedMime[] = ["image/png", "image/jpeg", "image/webp"];

/** Extensão exibida no `accept` do input. */
export const ACCEPT_ATTRIBUTE = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";

/**
 * Dimensões de saída por tipo de imagem.
 *
 * Logo aparece em 64 px na capa; 320 px cobre 4x (telas de alta densidade) com
 * folga. Capa ocupa a largura toda do celular (~430 px) e é recortada em 16:9:
 * 1600 px cobre 4x com sobra e mantém o arquivo em ~150 KB.
 */
export const OUTPUT_SIZE: Record<UploadKind, { width: number; height: number; quality: number }> = {
  logo: { width: 320, height: 320, quality: 0.9 },
  cover: { width: 1600, height: 900, quality: 0.82 },
};

/**
 * Assinaturas de arquivo (magic bytes).
 *
 * Renomear `.exe` para `.png` não engana isto: o conteúdo é que decide.
 */
export function sniffImageType(bytes: Uint8Array): AcceptedMime | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

export type FileCheck =
  | { ok: true; mime: AcceptedMime; extension: "png" | "jpg" | "webp" }
  | { ok: false; error: string };

function extensionFor(mime: AcceptedMime): "png" | "jpg" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/**
 * Valida um arquivo escolhido (ou arrastado) pelo usuário.
 *
 * Lê só os primeiros 16 bytes para a assinatura — não carrega o arquivo inteiro
 * em memória duas vezes.
 */
export async function checkImageFile(file: File): Promise<FileCheck> {
  if (!file || file.size === 0) {
    return { ok: false, error: "Selecione uma imagem." };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0);
    return { ok: false, error: `A imagem tem mais de ${mb} MB. Escolha uma menor.` };
  }

  // O tipo declarado é o primeiro filtro (barato); a assinatura confirma.
  if (file.type && !ACCEPTED_MIME.includes(file.type as AcceptedMime)) {
    return { ok: false, error: "Formato não suportado. Use PNG, JPG ou WEBP." };
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageType(head);

  if (!sniffed) {
    return { ok: false, error: "O arquivo não parece ser uma imagem PNG, JPG ou WEBP." };
  }

  return { ok: true, mime: sniffed, extension: extensionFor(sniffed) };
}

/** Recorta/redimensiona mantendo a proporção e cobrindo o alvo (object-fit: cover). */
export function fitWithin(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;

  if (sourceRatio > targetRatio) {
    // Fonte mais larga: corta as laterais.
    const sw = Math.round(sourceHeight * targetRatio);
    return { sx: Math.round((sourceWidth - sw) / 2), sy: 0, sw, sh: sourceHeight };
  }

  // Fonte mais alta: corta topo/base.
  const sh = Math.round(sourceWidth / targetRatio);
  return { sx: 0, sy: Math.round((sourceHeight - sh) / 2), sw: sourceWidth, sh };
}

export type OptimizeResult =
  | { ok: true; blob: Blob; extension: "png" | "jpg" | "webp"; width: number; height: number }
  | { ok: false; error: string };

/**
 * Redimensiona e recomprime a imagem no navegador.
 *
 * Usa WebP quando o `canvas` consegue exportar (`toBlob` devolve PNG quando não
 * consegue, e aí detectamos pelo `type`). SVG não entra: rasterizamos qualquer
 * coisa que o navegador consiga decodificar e o resultado é sempre bitmap.
 *
 * Se o navegador não tiver `canvas` (raro), devolve o original — melhor um
 * arquivo maior do que um fluxo quebrado.
 */
export async function optimizeImage(
  file: File,
  kind: UploadKind,
  canvasFactory: () => HTMLCanvasElement | null = defaultCanvas,
): Promise<OptimizeResult> {
  const checked = await checkImageFile(file);
  if (!checked.ok) return checked;

  const { width, height, quality } = OUTPUT_SIZE[kind];

  try {
    const bitmap = await createBitmap(file);
    if (!bitmap) {
      // Sem decodificação: sobe o original já validado.
      return { ok: true, blob: file, extension: checked.extension, width: 0, height: 0 };
    }

    const canvas = canvasFactory();
    if (!canvas) {
      return { ok: true, blob: file, extension: checked.extension, width: 0, height: 0 };
    }

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      return { ok: true, blob: file, extension: checked.extension, width: 0, height: 0 };
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const crop = fitWithin(bitmap.width, bitmap.height, width, height);
    context.drawImage(
      bitmap.source,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      0,
      0,
      width,
      height,
    );

    const blob = await toBlob(canvas, quality);

    // O navegador pode devolver PNG quando não sabe WebP. Nesse caso mantemos
    // PNG — o importante é o tamanho em pixels, que já caiu.
    const type = blob?.type === "image/webp" ? "webp" : "png";

    if (!blob) {
      return { ok: true, blob: file, extension: checked.extension, width: 0, height: 0 };
    }

    return { ok: true, blob, extension: type, width, height };
  } catch {
    // Ambiente sem canvas/imagem (ou arquivo corrompido): o check já passou,
    // então subimos o original em vez de bloquear o usuário.
    return { ok: true, blob: file, extension: checked.extension, width: 0, height: 0 };
  }
}

function defaultCanvas(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  return document.createElement("canvas");
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/webp", quality);
  });
}

type BitmapSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
};

async function createBitmap(file: File): Promise<BitmapSource | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      /* cai no fallback com <img> */
    }
  }

  if (typeof document === "undefined") return null;

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("imagem inválida"));
      element.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Nome do arquivo enviado (extensão coerente com o blob). */
export function uploadFileName(kind: UploadKind, extension: string, version: string): string {
  return `${kind}-${version}.${extension}`;
}
