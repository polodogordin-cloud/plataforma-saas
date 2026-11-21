import "server-only";

import type { WhatsappConfig, WhatsappOrderSummary } from "@/lib/whatsapp";

/**
 * Camada de integração do WhatsApp — Etapa 13.
 *
 * Segue a mesma disciplina de `src/lib/billing`: o que entra agora é o
 * **contrato**, não uma integração. E o provedor que existe hoje é honesto
 * sobre o que faz.
 *
 * ─── Por que existe uma camada, se hoje é só um link ──────────────────────
 *
 * O botão "Falar no WhatsApp" não precisa de servidor: é um `<a href="wa.me/…">`.
 * Bastaria montar a URL na tela. O motivo de haver um contrato por baixo é o
 * escopo do item 7 — amanhã o mesmo pedido de "mande esta mensagem" pode ser
 * atendido pela Cloud API oficial, e a tela não pode precisar saber a diferença.
 *
 * ─── Os dois provedores, e a diferença que importa ───────────────────────
 *
 *   • `link` (o de hoje): devolve uma URL. **Nada é enviado** — quem envia é a
 *     pessoa, tocando no botão. Não há status, não há confirmação, não há
 *     retentativa. É por isso que hoje é impossível "confirmar pedido por
 *     WhatsApp": o sistema não sabe se a mensagem saiu.
 *
 *   • `cloud` (a oficial, quando existir): envia pelo servidor com token, e
 *     recebe webhooks de entrega/leitura. Exige número verificado, conta
 *     aprovada e template aprovado pela Meta para mensagem fora da janela de
 *     24h. Nada disso está aqui — e é melhor que não esteja: uma "API falsa"
 *     que devolve sucesso sem enviar é pior do que nenhuma.
 *
 * ─── Regra que vale para qualquer provedor futuro ─────────────────────────
 *
 * Quem decide se o canal está liberado é o banco (`whatsapp_settings` para o
 * interruptor e o número, `plans.features` para o plano). O provedor só monta
 * a entrega. Autorização nunca é decidida por quem envia.
 */

/* -------------------------------------------------------------------------- */
/* Contrato                                                                    */
/* -------------------------------------------------------------------------- */

/** O que a interface pede. Hoje só o cardápio público usa. */
export type WhatsappIntent =
  /** Cliente quer conversar: mensagem inicial configurada pela casa. */
  | { kind: "contact"; config: WhatsappConfig }
  /** Pedido existente, já gravado. Preparado — não usado na interface. */
  | { kind: "order"; config: WhatsappConfig; order: WhatsappOrderSummary };

/**
 * Resultado de pedir uma entrega.
 *
 * `kind` é o que diferencia um link de uma mensagem enviada, e é o que impede
 * a interface de prometer o que não aconteceu:
 *
 *   • `link`: **abrir na tela**. A pessoa revisa e envia. Nada foi enviado.
 *   • `queued`: registro criado para envio pelo servidor, ainda não enviado.
 *   • `sent`: o provedor confirmou o envio (só provedor oficial).
 *   • `unavailable`: não há como entregar (sem número, sem plano, sem token).
 */
export type WhatsappDelivery =
  | { kind: "link"; url: string; message: string }
  | { kind: "queued"; messageId: string; message: string }
  | { kind: "sent"; messageId: string; externalId: string | null }
  | { kind: "unavailable"; reason: WhatsappUnavailableReason };

export type WhatsappUnavailableReason =
  /** A casa não ligou o WhatsApp ou o número não é válido. */
  | "not_configured"
  /** O plano atual não inclui `whatsapp` (ver `plans.features`). */
  | "plan_feature_missing"
  /** O provedor oficial não está configurado neste ambiente. */
  | "provider_not_configured";

/**
 * Provedor de entrega.
 *
 * Três métodos, e nenhum deles decide autorização: ele recebe uma intenção já
 * autorizada e monta/entrega. Implementar a Cloud API é criar
 * `src/lib/whatsapp/cloud.ts` com esta interface e trocar `getWhatsappProvider`.
 */
export type WhatsappProvider = {
  /** Identificador estável, gravado em `whatsapp_messages.provider`. */
  readonly id: "link" | "cloud";
  /**
   * `true` quando o provedor realmente entrega sozinho. A interface usa isso
   * para escolher as palavras: "Abrir no WhatsApp" × "Mensagem enviada".
   */
  readonly delivers: boolean;
  /** Monta a entrega de uma intenção. Não lança: falhas viram `unavailable`. */
  deliver(intent: WhatsappIntent): Promise<WhatsappDelivery>;
};

/* -------------------------------------------------------------------------- */
/* Provedor `link` — o que existe nesta etapa                                  */
/* -------------------------------------------------------------------------- */

/**
 * Provedor de link (`wa.me`).
 *
 * Não faz rede, não grava nada e não diz que enviou. Se a casa não configurou o
 * número, devolve `unavailable` em vez de uma URL sem destinatário.
 */
export const linkWhatsappProvider: WhatsappProvider = {
  id: "link",
  delivers: false,

  async deliver(intent) {
    const { buildWhatsappLink, buildOrderWhatsappLink, shouldShowWhatsappButton } = await import(
      "@/lib/whatsapp"
    );

    if (!shouldShowWhatsappButton(intent.config)) {
      return { kind: "unavailable", reason: "not_configured" };
    }

    if (intent.kind === "order") {
      const url = buildOrderWhatsappLink({ phone: intent.config.phone, order: intent.order });
      if (!url) {
        return { kind: "unavailable", reason: "not_configured" };
      }
      // `buildOrderMessage` é importado de novo para devolver o texto junto:
      // a interface mostra a prévia antes de abrir o WhatsApp.
      const { buildOrderMessage } = await import("@/lib/whatsapp");
      const message = buildOrderMessage(intent.order) ?? "";
      return { kind: "link", url, message };
    }

    const url = buildWhatsappLink({
      phone: intent.config.phone,
      message: intent.config.message,
    });

    if (!url) return { kind: "unavailable", reason: "not_configured" };

    return { kind: "link", url, message: intent.config.message };
  },
};

/**
 * Provedor oficial ausente.
 *
 * Existe para que a resposta seja explícita ("ainda não configurado") em vez de
 * um erro de importação — e para que ligar a Cloud API seja **remover** este
 * objeto, não descobrir onde ele era usado.
 */
export const unconfiguredCloudWhatsappProvider: WhatsappProvider = {
  id: "cloud",
  delivers: true,
  async deliver() {
    return { kind: "unavailable", reason: "provider_not_configured" };
  },
};

/* -------------------------------------------------------------------------- */
/* Seleção                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Provedor do ambiente.
 *
 * Hoje sempre `link`. A variável `WHATSAPP_PROVIDER` **não** liga a Cloud API
 * sozinha: mesmo com `WHATSAPP_PROVIDER=cloud`, o que existe é o provedor
 * "não configurado", que responde honestamente. Ligar a integração real exige
 * escrever `cloud.ts` — não é uma variável de ambiente que faz mágica.
 */
export function getWhatsappProvider(): WhatsappProvider {
  const requested = (process.env.WHATSAPP_PROVIDER ?? "").trim().toLowerCase();
  if (requested === "cloud") return unconfiguredCloudWhatsappProvider;
  return linkWhatsappProvider;
}

/**
 * Texto do botão no cardápio público.
 *
 * Curto de propósito: o botão divide a largura com o nome do restaurante em
 * 320px. "Falar no WhatsApp" é o que o escopo pede e cabe em uma linha no
 * tamanho do cardápio.
 */
export const WHATSAPP_BUTTON_LABEL = "Falar no WhatsApp";
