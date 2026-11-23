"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { saveNotificationPreferences } from "@/actions/notifications";
import {
  groupPreferences,
  type NotificationPreferenceItem,
} from "@/lib/notifications";
import { NotificationTypeIcon } from "@/components/notifications/notification-bell";
import { cn } from "@/lib/utils";

/**
 * Preferências de notificação — Etapa 26.
 *
 * Um switch por tipo, agrupado por assunto. Três decisões:
 *
 * 1. **Nasce tudo ligado.** O banco guarda o que está *desligado*; ausência de
 *    preferência = recebe. Tipo novo no enum aparece ligado sem deploy — que é
 *    o comportamento certo para aviso operacional.
 *
 * 2. **Salvar explícito.** Cada toque não chama o servidor. Trocar cinco
 *    switches em 3G dispararia cinco escritas e cinco revalidações; a pessoa
 *    toca, confere e salva uma vez.
 *
 * 3. **Mostra o que muda na prática.** O texto de cada grupo diz o que deixa de
 *    chegar, não "notificação do tipo X". Desligar "novo pedido" precisa ser
 *    lido como "não vou saber que chegou pedido".
 */
export function NotificationPreferencesForm({
  restaurantId,
  initialDisabled,
  catalog,
}: {
  restaurantId: string;
  initialDisabled: string[];
  catalog: NotificationPreferenceItem[];
}) {
  const [disabled, setDisabled] = useState<Set<string>>(() => new Set(initialDisabled));
  const [savedDisabled, setSavedDisabled] = useState<Set<string>>(
    () => new Set(initialDisabled),
  );
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const groups = useMemo(() => groupPreferences(catalog), [catalog]);

  const dirty =
    disabled.size !== savedDisabled.size ||
    [...disabled].some((type) => !savedDisabled.has(type));

  function toggle(type: string) {
    setFeedback(null);
    setDisabled((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function submit() {
    startTransition(async () => {
      const result = await saveNotificationPreferences({
        restaurantId,
        disabled: [...disabled],
      });

      if (result.ok === false) {
        setFeedback({ ok: false, text: result.error });
        return;
      }

      setSavedDisabled(new Set(disabled));
      setFeedback({
        ok: true,
        text: disabled.size === 0 ? "Tudo ligado de novo." : "Preferências salvas.",
      });
    });
  }

  if (groups.length === 0) {
    return (
      <Card>
        <p className="text-sm text-ink-600">
          Não foi possível carregar os tipos de notificação. Recarregue a página.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.group}>
          <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
            {group.group}
          </p>
          <Card className="divide-y divide-ink-100 p-0">
            {group.items.map((item) => {
              const on = !disabled.has(item.type);
              return (
                <label
                  key={item.type}
                  className="flex min-h-14 cursor-pointer items-center gap-3 px-3.5 py-2.5"
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-lg",
                      on ? "bg-brand-50 text-brand-700" : "bg-ink-100 text-ink-400",
                    )}
                  >
                    <NotificationTypeIcon type={item.type} className="size-4" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink-900">{item.label}</span>
                    <span className="block text-xs leading-snug text-ink-500">
                      {on ? "Avisa no sino" : "Não avisa"}
                    </span>
                  </span>

                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(item.type)}
                    // O rótulo já envolve o input; `aria-label` repete o nome do
                    // tipo para o leitor de tela não ler "Avisa no sino" antes.
                    aria-label={item.label}
                    className="size-5 shrink-0 accent-brand-600"
                  />
                </label>
              );
            })}
          </Card>
        </div>
      ))}

      {feedback && (
        <p
          role="status"
          className={cn(
            "flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs leading-snug",
            feedback.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700",
          )}
        >
          {feedback.ok ? (
            <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          )}
          {feedback.text}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending || !dirty}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white active:scale-[0.99] disabled:opacity-50"
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {pending ? "Salvando…" : dirty ? "Salvar preferências" : "Tudo salvo"}
      </button>

      <p className="px-1 text-center text-[11px] leading-snug text-ink-500">
        Desligar um aviso não muda o funcionamento do restaurante: o pedido continua entrando, a
        chamada continua chegando. Só o sino fica quieto.
      </p>
    </div>
  );
}
