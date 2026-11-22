import {
  PRINT_PROVIDER_HINT,
  PRINT_PROVIDER_LABEL,
  PRINT_PROVIDER_SUPPORT,
  type PaperWidth,
  type PrintJobStatus,
  type PrintOrderDocument,
  type PrintProviderKind,
} from "@/lib/types";
import { providerIsAvailable, resolveJobStatus, ticketText } from "@/lib/printing";

/**
 * `PrintProvider` — a abstração que a Etapa 18 deixa pronta.
 *
 * ─── A regra que define este arquivo ──────────────────────────────────────
 *
 * Uma impressora térmica não é alcançável por uma página web. Não existe API
 * de navegador para ESC/POS, para a porta USB, para a fila do sistema ou para
 * a impressora na rede. O que existe é `window.print()`, que abre a caixa de
 * diálogo do sistema e entrega o trabalho ao driver — depois disso o app não
 * sabe absolutamente nada (a pessoa pode escolher outra impressora, trocar o
 * papel ou cancelar).
 *
 * Então a abstração tem dois tipos de método, e isso é intencional:
 *
 *   • `printOrder` / `testPrint` — o app **pode** chamar. No provedor de
 *     navegador eles entregam o documento à caixa de diálogo e devolvem
 *     `requested`, nunca `printed`.
 *
 *   • `connect` / `disconnect` — existem porque um bridge local e um serviço
 *     em nuvem precisam de sessão (handshake, token, pareamento). No provedor
 *     de navegador eles respondem `supported: false` com o motivo. Preencher
 *     isso com um `resolve()` mentiroso faria a tela dizer "impressora
 *     conectada" para um aparelho que ninguém tocou.
 *
 * Nenhum provedor futuro é implementado aqui. O que existe é o contrato e um
 * registro que sabe dizer "isto ainda não está disponível", que é a resposta
 * correta hoje.
 */

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export type PrintJobRequest = {
  document: PrintOrderDocument;
  width: PaperWidth;
  copies: number;
  /** Rótulo da via: "2ª via". */
  copyLabel?: string | null;
  showPrices?: boolean;
};

export type PrintResult = {
  ok: boolean;
  status: PrintJobStatus;
  /** Mensagem para a pessoa. Nunca "sucesso" quando não há confirmação. */
  message: string;
  /** O provedor sabe se o papel saiu? Hoje: só o bridge saberia. */
  confirmed: boolean;
};

export type ProviderConnection = {
  supported: boolean;
  connected: boolean;
  /** Por que não deu. Sempre em português, sempre específico. */
  reason: string | null;
};

export interface PrintProvider {
  readonly kind: PrintProviderKind;
  readonly label: string;
  /** `true` quando o app consegue conversar com o equipamento sem ajuda. */
  readonly available: boolean;
  readonly hint: string;

  connect(request: ProviderConnectRequest): Promise<ProviderConnection>;
  disconnect(): Promise<void>;
  testPrint(request: PrintJobRequest): Promise<PrintResult>;
  printOrder(request: PrintJobRequest): Promise<PrintResult>;
}

export type ProviderConnectRequest = {
  /** Nome/id da impressora cadastrada, quando houver. */
  printerName?: string | null;
  /** Fila do sistema, IP:porta ou identificador da bridge. */
  identifier?: string | null;
};

/**
 * Executor de impressão do navegador.
 *
 * Injetado (e não chamado direto) por dois motivos: permite testar o provedor
 * sem `window.print`, e deixa explícito que a única coisa que o app faz é
 * *pedir* a impressão.
 */
export type PrintExecutor = (request: PrintJobRequest) => Promise<void> | void;

/* -------------------------------------------------------------------------- */
/* Provedor de navegador — o único que existe hoje                            */
/* -------------------------------------------------------------------------- */

export class BrowserPrintProvider implements PrintProvider {
  readonly kind = "browser" as const;
  readonly label = PRINT_PROVIDER_LABEL.browser;
  readonly available = true;
  readonly hint = PRINT_PROVIDER_HINT.browser;

  private readonly executor: PrintExecutor;

  constructor(executor: PrintExecutor) {
    this.executor = executor;
  }

  /**
   * Não há o que conectar.
   *
   * Devolver `connected: true` seria a mentira mais fácil e a mais cara: a tela
   * mostraria "impressora pronta" para todo mundo, inclusive para quem nunca
   * instalou o driver. `supported: false` é a verdade do navegador.
   */
  async connect(): Promise<ProviderConnection> {
    return {
      supported: false,
      connected: false,
      reason:
        "O navegador não mantém conexão com a impressora. A térmica é escolhida na janela de impressão do sistema, a cada impressão.",
    };
  }

  async disconnect(): Promise<void> {
    // Nada a encerrar: não existe sessão.
  }

  async printOrder(request: PrintJobRequest): Promise<PrintResult> {
    return this.run(request, "Pedido enviado para a janela de impressão.");
  }

  async testPrint(request: PrintJobRequest): Promise<PrintResult> {
    return this.run(request, "Página de teste enviada para a janela de impressão.");
  }

  private async run(request: PrintJobRequest, message: string): Promise<PrintResult> {
    try {
      await this.executor(request);
    } catch {
      return {
        ok: false,
        status: "failed",
        message:
          "Não foi possível abrir a janela de impressão. Verifique se o navegador permite imprimir nesta página.",
        confirmed: false,
      };
    }

    return {
      ok: true,
      status: resolveJobStatus("browser"),
      // O texto não diz "impresso": diz que a janela abriu. É tudo o que se sabe.
      message: `${message} Confirme a impressora na janela do sistema.`,
      confirmed: false,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Provedor indisponível — resposta honesta para o que ainda não existe       */
/* -------------------------------------------------------------------------- */

/**
 * Provedor declarado, ainda não implementado.
 *
 * Existe para que a tela possa listar as opções ("Bridge local", "Web Print")
 * sem que nenhum caminho de código finja ter impresso. `printOrder` devolve
 * `unsupported` com o motivo, e a UI mostra isso como informação, não como
 * falha do usuário.
 */
export class UnavailablePrintProvider implements PrintProvider {
  readonly kind: PrintProviderKind;
  readonly label: string;
  readonly available = false;
  readonly hint: string;

  constructor(kind: Exclude<PrintProviderKind, "browser">) {
    this.kind = kind;
    this.label = PRINT_PROVIDER_LABEL[kind];
    this.hint = PRINT_PROVIDER_HINT[kind];
  }

  async connect(): Promise<ProviderConnection> {
    return { supported: false, connected: false, reason: this.hint };
  }

  async disconnect(): Promise<void> {
    // Sem sessão.
  }

  async testPrint(): Promise<PrintResult> {
    return this.unsupported();
  }

  async printOrder(): Promise<PrintResult> {
    return this.unsupported();
  }

  private unsupported(): PrintResult {
    return {
      ok: false,
      status: "unsupported",
      message: `${this.label} ainda não está disponível. ${this.hint}`,
      confirmed: false,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Registro                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Fábrica de provedores.
 *
 * `browser` devolve o provedor real; os demais devolvem o indisponível. Quem
 * implementar um bridge no futuro troca uma linha aqui — o resto da aplicação
 * continua chamando a mesma interface.
 */
export function createPrintProvider(
  kind: PrintProviderKind,
  executor?: PrintExecutor,
): PrintProvider {
  if (kind === "browser") {
    return new BrowserPrintProvider(
      executor ??
        (() => {
          if (typeof window !== "undefined" && typeof window.print === "function") {
            window.print();
          }
        }),
    );
  }

  return new UnavailablePrintProvider(kind);
}

/** Lista para a tela de configuração: todos os provedores, com o estado real. */
export function listPrintProviders(): Array<{
  kind: PrintProviderKind;
  label: string;
  hint: string;
  available: boolean;
}> {
  return (Object.keys(PRINT_PROVIDER_LABEL) as PrintProviderKind[]).map((kind) => ({
    kind,
    label: PRINT_PROVIDER_LABEL[kind],
    hint: PRINT_PROVIDER_HINT[kind],
    available: providerIsAvailable(kind),
  }));
}

/**
 * Texto do cupom pronto para `document.title` / arquivo / bridge.
 *
 * Fora do provedor de propósito: quem monta o texto é `printing.ts` (puro e
 * testado); quem entrega é o provedor. Assim um bridge futuro recebe o mesmo
 * cupom que a tela imprimiu, sem reimplementar layout.
 */
export function jobPayload(request: PrintJobRequest): {
  text: string;
  width: PaperWidth;
  copies: number;
} {
  return {
    text: ticketText(request.document, {
      width: request.width,
      copyLabel: request.copyLabel ?? null,
      showPrices: request.showPrices,
    }),
    width: request.width,
    copies: request.copies,
  };
}
