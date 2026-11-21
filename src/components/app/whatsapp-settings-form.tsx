"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Copy, Loader2, MessageCircle } from "lucide-react";
import { saveWhatsappSettings } from "@/actions/whatsapp";
import { Field, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_WHATSAPP_MESSAGE,
  WHATSAPP_MESSAGE_MAX,
  buildWhatsappLink,
  formatWhatsappNumber,
  normalizeWhatsappNumber,
  type WhatsappConfig,
} from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

/**
 * Formulário do WhatsApp — Etapa 13.
 *
 * Controlado (não `useActionState` + `FormData`) porque a tela mostra uma
 * **prévia ao vivo** do link: o dono precisa ver que a mensagem que ele escreveu
 * é a que o cliente vai receber antes de publicar. Isso exige o valor atual do
 * campo a cada tecla.
 *
 * A validação aqui é só para dar retorno imediato; quem decide é o servidor
 * (Zod na Server Action + `save_whatsapp_settings` no banco). Um `fetch` direto
 * à RPC com número inválido continua sendo recusado.
 */
export function WhatsappSettingsForm({
  restaurantName,
  restaurantSlug,
  initialConfig,
  formattedPhone,
  canUseWhatsapp,
}: {
  restaurantName: string;
  restaurantSlug: string;
  initialConfig: WhatsappConfig;
  /** Número já formatado para exibição ("(11) 99999-0000"). */
  formattedPhone: string;
  canUseWhatsapp: boolean;
}) {
  const [phone, setPhone] = useState(initialConfig.phone ?? "");
  const [message, setMessage] = useState(initialConfig.message || DEFAULT_WHATSAPP_MESSAGE);
  const [isActive, setIsActive] = useState(initialConfig.isActive);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const normalized = useMemo(() => normalizeWhatsappNumber(phone), [phone]);
  const displayPhone = normalized ? formatWhatsappNumber(normalized) : "";
  const canActivate = normalized !== null;

  /**
   * Prévia do link.
   *
   * Monta o **mesmo** `wa.me` que o cardápio vai montar — a função é a mesma
   * (`buildWhatsappLink`), então a prévia não pode divergir do que o cliente
   * recebe.
   */
  const previewLink = useMemo(
    () => (normalized ? buildWhatsappLink({ phone: normalized, message }) : null),
    [normalized, message],
  );

  /**
   * Houve mudança desde o último estado gravado?
   *
   * Compara o texto digitado com o valor gravado (que é sempre o número
   * normalizado, ex.: "5511999990000"). Por isso digitar ou colar
   * "(11) 99999-0000" conta como edição mesmo sendo o mesmo número: normalizar
   * aqui faria o botão ignorar a primeira digitação de um número novo.
   */
  const dirty =
    // Compara o **texto digitado** com o que estava gravado, não o
    // interpretado: "999999" não normaliza para nada, mas é uma edição — e o
    // dono precisa poder salvar para ver o erro do servidor.
    phone.trim() !== (initialConfig.phone ?? "") ||
    message.trim() !== (initialConfig.message ?? "") ||
    isActive !== initialConfig.isActive;

  /**
   * Pode salvar?
   *
   * Basta haver mudança. A validação do número acontece no `save()` e no
   * servidor — travar o botão por número inválido esconderia a mensagem de
   * erro justamente de quem está digitando o número errado.
   */
  const canSave = dirty && !pending;

  const save = (nextActive = isActive) => {
    setFieldError(null);
    setFeedback(null);

    if (nextActive && !normalized) {
      setFieldError("Informe o número de WhatsApp para ativar.");
      return;
    }

    startTransition(async () => {
      const result = await saveWhatsappSettings({
        phone,
        message,
        isActive: nextActive,
      });

      if (!result.ok) {
        setFeedback({ ok: false, text: result.error });
        if (result.fieldErrors?.phone?.[0]) setFieldError(result.fieldErrors.phone[0]);
        return;
      }

      setIsActive(result.config.isActive);
      setPhone(result.config.phone ?? "");
      setMessage(result.config.message);
      setFeedback({ ok: true, text: result.message });
    });
  };

  const copyLink = async () => {
    if (!previewLink) return;
    try {
      await navigator.clipboard.writeText(previewLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Área de transferência bloqueada (iOS antigo, contexto inseguro): o
      // link continua visível na tela para copiar à mão.
      setCopied(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Interruptor primeiro: é a pergunta que o dono vem responder. */}
      <div className="rounded-2xl border border-ink-200 bg-white p-4">
        <Switch
          checked={isActive}
          onChange={(next) => {
            if (next && !canActivate) {
              setFieldError("Informe o número de WhatsApp para ativar.");
              return;
            }
            setIsActive(next);
            save(next);
          }}
          label="WhatsApp ativo no cardápio"
          description={
            isActive
              ? "O botão aparece no seu cardápio público."
              : "O botão não aparece para os clientes."
          }
          disabled={pending}
        />
        {isActive && !normalized && (
          <p className="mt-2 text-xs text-red-600">
            Falta um número válido — o botão não aparece sem ele.
          </p>
        )}
      </div>

      {feedback && (
        <FormAlert tone={feedback.ok ? "success" : "error"}>{feedback.text}</FormAlert>
      )}

      <fieldset className="space-y-4" disabled={pending}>
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
          Número
        </legend>

        <Field
          label="WhatsApp do restaurante"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
            setFieldError(null);
          }}
          placeholder="(11) 99999-0000"
          hint={
            displayPhone
              ? `Vai ser usado como ${displayPhone} (Brasil +55).`
              : "Com DDD. Pode colar no formato que preferir — a gente ajusta."
          }
          error={fieldError ?? undefined}
        />
      </fieldset>

      <fieldset className="space-y-2" disabled={pending}>
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
          Mensagem inicial
        </legend>

        <Textarea
          label="O que já vem escrito para o cliente"
          name="message"
          rows={3}
          maxLength={WHATSAPP_MESSAGE_MAX}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={DEFAULT_WHATSAPP_MESSAGE}
          hint={`${message.trim().length}/${WHATSAPP_MESSAGE_MAX} caracteres.`}
        />

        <button
          type="button"
          onClick={() => setMessage(DEFAULT_WHATSAPP_MESSAGE)}
          className="inline-flex min-h-11 items-center text-xs font-semibold text-brand-700 underline-offset-2 hover:underline"
        >
          Usar a mensagem sugerida
        </button>
      </fieldset>

      {/* Prévia: mostra o botão e o link exatamente como o cliente vê. */}
      {previewLink && (
        <section className="space-y-2 rounded-2xl border border-ink-200 bg-ink-50 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Prévia no cardápio
          </h2>

          <span
            className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl px-5 py-3.5 text-[0.95rem] font-semibold"
            style={{ backgroundColor: "#25d366", color: "#0b3d24" }}
          >
            <MessageCircle className="size-5 shrink-0" aria-hidden="true" strokeWidth={2.4} />
            Falar no WhatsApp
          </span>

          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-white p-2 text-[0.7rem] leading-snug text-ink-500">
              {previewLink}
            </code>
            <button
              type="button"
              onClick={copyLink}
              className="grid size-11 shrink-0 place-items-center rounded-lg border border-ink-200 bg-white text-ink-600"
              aria-label={copied ? "Link copiado" : "Copiar link"}
            >
              {copied ? (
                <Check className="size-4 text-brand-600" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>

          <p className="text-xs leading-relaxed text-ink-500">
            Ao tocar, o WhatsApp abre com a sua mensagem já escrita. Quem envia é o
            cliente — o Menuvo não dispara mensagens.
          </p>
        </section>
      )}

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] -mx-1 px-1 pt-2">
        <button
          type="button"
          onClick={() => save()}
          disabled={!canSave}
          className={cn(
            "tap-target flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5",
            "text-[0.95rem] font-semibold text-white transition active:scale-[0.99]",
            "bg-brand-600 hover:bg-brand-700 disabled:opacity-60",
          )}
        >
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Salvando…
            </>
          ) : (
            "Salvar"
          )}
        </button>

        <p className="mt-2 text-center text-[0.7rem] text-ink-400">
          {canUseWhatsapp
            ? `Cardápio: /r/${restaurantSlug}`
            : `O botão aparece quando o plano liberar · /r/${restaurantSlug}`}
        </p>
      </div>
    </div>
  );
}
