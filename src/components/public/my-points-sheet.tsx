"use client";

import { useState, useTransition } from "react";
import { Loader2, Star } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { readMyPoints } from "@/actions/loyalty";
import { isValidPhone, maskPhoneInput } from "@/lib/loyalty";
import { formatPrice } from "@/lib/validation";

/**
 * "Meus pontos" no cardápio público — Etapa 24.
 *
 * A interface mais simples que resolve o pedido do escopo ("cliente deve
 * conseguir consultar saldo por uma interface simples"): um campo de WhatsApp e
 * um botão. Não é login, não cria senha, não instala nada.
 *
 * ─── A credencial é mesa + telefone ──────────────────────────────────────
 *
 * Vem do mesmo raciocínio da Etapa 6 (mesa + número do pedido para reler o
 * pedido): quem está na mesa com o QR na mão e sabe o próprio número é o dono
 * do saldo. Não é autenticação forte e não finge ser — por isso a resposta traz
 * só nome, saldo e o texto do programa. Extrato e histórico ficam no painel do
 * restaurante.
 *
 * A tela **nunca** revela se o número existe em outro restaurante: o token da
 * mesa fixa a casa, e um telefone desconhecido devolve a mesma mensagem sempre.
 */
export function MyPointsSheet({
  open,
  onClose,
  tableToken,
  tableName,
  programNote,
  redeemValue,
}: {
  open: boolean;
  onClose: () => void;
  tableToken: string | null;
  tableName?: string | null;
  programNote?: string | null;
  redeemValue?: number;
}) {
  const [phone, setPhone] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { ok: true; name: string | null; balance: number } | { ok: false; error: string } | null
  >(null);

  const ask = () => {
    if (!tableToken) return;
    if (!isValidPhone(phone)) {
      setResult({ ok: false, error: "Confira o WhatsApp: informe DDD e número." });
      return;
    }

    startTransition(async () => {
      const response = await readMyPoints({ tableToken, phone });
      setResult(
        response.ok
          ? { ok: true, name: response.points.name, balance: response.points.balance }
          : { ok: false, error: response.error },
      );
    });
  };

  const close = () => {
    // Limpa na saída: o próximo cliente na mesa não deve ver o saldo do
    // anterior no campo, nem o resultado.
    setPhone("");
    setResult(null);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Meus pontos"
      description={tableName ? `Consulta para ${tableName}` : "Consulte seu saldo"}
      size="tall"
      footer={
        !result?.ok ? (
          <button
            type="button"
            onClick={ask}
            disabled={pending || !tableToken}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--mv-primary)] text-sm font-bold text-white active:scale-[0.99] disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {pending ? "Consultando…" : "Ver meu saldo"}
          </button>
        ) : (
          <button
            type="button"
            onClick={close}
            className="flex min-h-12 w-full items-center justify-center rounded-xl border border-[var(--mv-border)] text-sm font-semibold text-[var(--mv-text)] active:scale-[0.99]"
          >
            Fechar
          </button>
        )
      }
    >
      <div className="space-y-4">
        {programNote && (
          <p className="rounded-xl bg-[var(--mv-primary-soft)] px-3.5 py-2.5 text-xs leading-snug text-[var(--mv-text)]">
            {programNote}
          </p>
        )}

        {!result?.ok && (
          <div>
            <label className="block">
              <span className="text-xs font-medium text-[var(--mv-text-muted)]">
                Seu WhatsApp (o mesmo do pedido)
              </span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(maskPhoneInput(event.target.value))}
                placeholder="(85) 99999-8888"
                className="mt-1 w-full rounded-xl border border-[var(--mv-border)] bg-[var(--mv-surface)] px-3.5 py-2.5 text-sm text-[var(--mv-text)] placeholder:text-[var(--mv-text-muted)] focus:border-[var(--mv-primary)] focus:outline-none"
              />
            </label>
            <p className="mt-2 text-[11px] leading-snug text-[var(--mv-text-muted)]">
              Usamos o número só para achar seu cadastro nesta casa. Não enviamos mensagem.
            </p>
          </div>
        )}

        {result?.ok && (
          <div className="space-y-3 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-[var(--mv-primary-soft)] text-[var(--mv-primary)]">
              <Star className="size-6" aria-hidden="true" />
            </span>
            <div>
              {result.name && (
                <p className="text-sm font-medium text-[var(--mv-text-muted)]">Olá, {result.name}</p>
              )}
              <p className="mt-1 text-4xl font-bold tabular-nums text-[var(--mv-text)]">
                {result.balance.toLocaleString("pt-BR")}
              </p>
              <p className="text-xs text-[var(--mv-text-muted)]">pontos disponíveis</p>
            </div>

            {redeemValue && redeemValue > 0 ? (
              <p className="text-xs text-[var(--mv-text-muted)]">
                Equivalem a{" "}
                <span className="font-semibold text-[var(--mv-text)]">
                  {formatPrice(Math.round(result.balance * redeemValue * 100) / 100)}
                </span>{" "}
                em desconto. Fale com o atendente para resgatar.
              </p>
            ) : (
              <p className="text-xs text-[var(--mv-text-muted)]">
                Continue pedindo para juntar mais. O resgate é feito no balcão.
              </p>
            )}
          </div>
        )}

        {result && !result.ok && (
          <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-xs leading-snug text-red-700" role="alert">
            {result.error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
