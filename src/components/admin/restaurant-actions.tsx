"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { logSupportAccess, setRestaurantStatus } from "@/actions/admin";
import { Button, ButtonLink } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import type { RestaurantStatus } from "@/lib/types";

/**
 * Ações administrativas no detalhe de uma casa.
 *
 * "Abrir cardápio" passa primeiro por `logSupportAccess`: o escopo pede acesso
 * de suporte **controlado**, e controlar significa deixar rastro de quem viu o
 * quê. A navegação só acontece depois que o registro volta com sucesso — se a
 * auditoria falhar, o acesso não acontece, e é isso que faz a trilha valer
 * alguma coisa.
 */
export function RestaurantActions({
  restaurantId,
  restaurantName,
  slug,
  status,
  suspendedReason,
}: {
  restaurantId: string;
  restaurantName: string;
  slug: string;
  status: RestaurantStatus;
  suspendedReason: string | null;
}) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reason, setReason] = useState(suspendedReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [supportPending, startSupportTransition] = useTransition();

  const change = (next: "published" | "paused" | "suspended") => {
    startTransition(async () => {
      const result = await setRestaurantStatus({
        restaurantId,
        status: next,
        reason: next === "suspended" ? reason : null,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setSheetOpen(false);
      router.refresh();
    });
  };

  const openSupport = () => {
    startSupportTransition(async () => {
      const result = await logSupportAccess(restaurantId, note || "Abertura do cardápio público");
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSupportOpen(false);
      // `window.open` depois do registro: a aba abre com a trilha já gravada.
      window.open(`/r/${slug}`, "_blank", "noopener,noreferrer");
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {status === "suspended" ? (
          <Button block onClick={() => change("published")} loading={pending}>
            Reativar restaurante
          </Button>
        ) : (
          <>
            <Button
              block
              variant={status === "published" ? "secondary" : "primary"}
              onClick={() => change(status === "published" ? "paused" : "published")}
              loading={pending}
            >
              {status === "published" ? "Desativar" : "Ativar"}
            </Button>
            <Button
              block
              variant="secondary"
              className="border-red-200 text-red-700 hover:bg-red-50"
              onClick={() => {
                setError(null);
                setSheetOpen(true);
              }}
            >
              <ShieldAlert className="size-4" aria-hidden="true" />
              Suspender
            </Button>
          </>
        )}
      </div>

      <ButtonLink
        href={`/admin/restaurantes/${restaurantId}/editar`}
        variant="secondary"
        block
        size="sm"
      >
        Editar dados e plano
      </ButtonLink>

      <Button
        variant="ghost"
        block
        size="sm"
        onClick={() => {
          setError(null);
          setSupportOpen(true);
        }}
      >
        <ExternalLink className="size-4" aria-hidden="true" />
        Abrir cardápio público (registra na auditoria)
      </Button>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Suspensão */}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Suspender restaurante">
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            Suspender <strong className="font-semibold text-ink-900">{restaurantName}</strong>{" "}
            derruba o cardápio público <em>e</em> bloqueia o acesso do restaurante ao painel.
            O dono vê o motivo abaixo e só a plataforma pode reativar.
          </p>

          <label className="block">
            <span className="text-sm font-medium text-ink-800">Motivo (o dono vê)</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={280}
              placeholder="Ex.: pendência de pagamento"
              className="mt-1.5 w-full rounded-xl border border-ink-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            <span className="mt-1 block text-right text-[0.7rem] text-ink-400">
              {reason.length}/280
            </span>
          </label>

          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => setSheetOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              block
              className="bg-red-600 hover:bg-red-700"
              onClick={() => change("suspended")}
              loading={pending}
              disabled={!reason.trim()}
            >
              Suspender
            </Button>
          </div>
        </div>
      </Sheet>

      {/* Acesso de suporte */}
      <Sheet open={supportOpen} onClose={() => setSupportOpen(false)} title="Acesso de suporte">
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            Este É o cardápio que o cliente vê. O registro fica na auditoria com
            seu e-mail, a casa e o horário — acesso administrativo sem rastro é
            o que não pode existir.
          </p>

          <label className="block">
            <span className="text-sm font-medium text-ink-800">Motivo do acesso</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={200}
              placeholder="Ex.: cliente relatou imagem quebrada"
              className="mt-1.5 h-12 w-full rounded-xl border border-ink-200 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </label>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              block
              onClick={() => setSupportOpen(false)}
              disabled={supportPending}
            >
              Cancelar
            </Button>
            <Button block onClick={openSupport} loading={supportPending}>
              {supportPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ExternalLink className="size-4" aria-hidden="true" />
              )}
              Registrar e abrir
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}


/**
 * Troca de papel de um membro da casa.
 *
 * Cada papel traz o efeito em uma linha ("sem gerenciar equipe"): quem está
 * usando o painel de suporte não deveria precisar lembrar o que `manager`
 * significa no banco.
 */
export function MemberRoleSheet({
  open,
  onClose,
  onConfirm,
  memberName,
  pending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (role: "owner" | "admin" | "manager" | "staff" | "kitchen" | "waiter") => void;
  memberName: string;
  pending: boolean;
  error: string | null;
}) {
  const [role, setRole] =
    useState<"owner" | "admin" | "manager" | "staff" | "kitchen" | "waiter">("staff");

  const options = [
    { id: "owner" as const, label: "Proprietário", hint: "Tudo, inclusive a equipe" },
    { id: "admin" as const, label: "Administrador", hint: "Tudo, inclusive a equipe" },
    { id: "manager" as const, label: "Gerente", hint: "Operação, sem gerenciar equipe" },
    { id: "staff" as const, label: "Equipe", hint: "Vê e opera o dia a dia" },
    // Etapa 17: os dois papéis do painel de cozinha. O texto explica o recorte
    // porque a diferença entre eles e `staff` é justamente o que NÃO podem.
    { id: "kitchen" as const, label: "Cozinha", hint: "Só o painel da cozinha, sem cardápio" },
    { id: "waiter" as const, label: "Garçom", hint: "Pedidos e entrega, sem cancelar" },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="Alterar papel">
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          Novo papel de <strong className="font-semibold text-ink-900">{memberName}</strong>.
        </p>

        <div className="space-y-2">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setRole(option.id)}
              aria-pressed={role === option.id}
              className={
                role === option.id
                  ? "w-full rounded-xl border border-brand-300 bg-brand-50 p-3 text-left"
                  : "w-full rounded-xl border border-ink-200 bg-white p-3 text-left hover:bg-ink-50"
              }
            >
              <span className="block text-sm font-semibold text-ink-900">{option.label}</span>
              <span className="block text-xs text-ink-500">{option.hint}</span>
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button block onClick={() => onConfirm(role)} loading={pending}>
            Salvar papel
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
