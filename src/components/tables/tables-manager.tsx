"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Armchair, Plus, Search, X } from "lucide-react";
import { TableCard } from "@/components/tables/table-card";
import { TableSheet } from "@/components/tables/table-sheet";
import { QrSheet } from "@/components/tables/qr-sheet";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { Button } from "@/components/ui/button";
import { deleteTable } from "@/actions/tables";
import { nextTableName } from "@/lib/validation";
import type { RestaurantTable } from "@/lib/types";
import { cn, normalizeSearch } from "@/lib/utils";

type Props = {
  restaurantId: string;
  restaurantSlug: string;
  origin: string;
  initialTables: RestaurantTable[];
  canEdit: boolean;
};

/**
 * Painel de mesas.
 *
 * Lista de cartões (nunca tabela), busca por nome/código, criação e edição em
 * bottom sheet e o QR Code em um cartão próprio para imprimir.
 */
export function TablesManager({
  restaurantSlug,
  origin,
  initialTables,
  canEdit,
}: Props) {
  const router = useRouter();

  const [tables, setTables] = useState(initialTables);
  const [query, setQuery] = useState("");

  const [form, setForm] = useState<{ open: boolean; table: RestaurantTable | null }>({
    open: false,
    table: null,
  });
  const [qr, setQr] = useState<{ open: boolean; table: RestaurantTable | null }>({
    open: false,
    table: null,
  });
  const [confirm, setConfirm] = useState<RestaurantTable | null>(null);

  // Sincroniza quando o servidor revalida (criar/editar/excluir/rotacionar).
  const [syncedFrom, setSyncedFrom] = useState(initialTables);
  if (initialTables !== syncedFrom) {
    setSyncedFrom(initialTables);
    setTables(initialTables);
  }

  const filtered = useMemo(() => {
    const needle = normalizeSearch(query);
    if (!needle) return tables;
    return tables.filter(
      (table) =>
        normalizeSearch(table.name).includes(needle) ||
        normalizeSearch(table.code).includes(needle),
    );
  }, [tables, query]);

  const activeCount = tables.filter((table) => table.is_active).length;
  const suggestedName = useMemo(
    () => nextTableName(tables.map((table) => table.name)),
    [tables],
  );

  /** URL absoluta da mesa: a mesma para QR Code e para a TAG NFC (Etapa 5). */
  const urlFor = (table: RestaurantTable) =>
    `${origin}/r/${restaurantSlug}/table/${table.public_token}`;

  const handleDelete = async () => {
    if (!confirm) return;
    const id = confirm.id;
    const result = await deleteTable(id);
    if (result.ok) {
      setTables((current) => current.filter((table) => table.id !== id));
      router.refresh();
    }
    setConfirm(null);
  };

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryTile label="Mesas" value={tables.length} />
        <SummaryTile label="Ativas" value={activeCount} tone="brand" />
        <SummaryTile
          label="Desativadas"
          value={tables.length - activeCount}
          tone={tables.length - activeCount > 0 ? "amber" : "neutral"}
        />
      </div>

      {/* Busca */}
      {tables.length > 4 && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-ink-400"
            aria-hidden="true"
          />
          <input
            type="search"
            inputMode="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar mesa"
            aria-label="Buscar mesa"
            className="w-full rounded-xl border border-ink-200 bg-white py-3 pl-11 pr-11 text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpar busca"
              className="tap-target absolute right-1 top-1/2 grid w-10 -translate-y-1/2 place-items-center rounded-lg text-ink-400"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {/* Lista */}
      {tables.length === 0 ? (
        <EmptyState
          canEdit={canEdit}
          onCreate={() => setForm({ open: true, table: null })}
        />
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-300 bg-white px-4 py-6 text-center text-sm text-ink-500">
          Nenhuma mesa encontrada para “{query.trim()}”.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((table) => (
            <li key={table.id}>
              <TableCard
                table={table}
                canEdit={canEdit}
                onShowQr={() => setQr({ open: true, table })}
                onEdit={() => setForm({ open: true, table })}
                onActiveChange={(id, isActive) =>
                  setTables((current) =>
                    current.map((item) =>
                      item.id === id ? { ...item, is_active: isActive } : item,
                    ),
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}

      {canEdit && tables.length > 0 && (
        <p className="pb-1 text-center text-xs leading-relaxed text-ink-400">
          O QR Code aponta para um endereço único da mesa. Mudar preços ou fotos no
          cardápio não exige reimprimir nada.
        </p>
      )}

      {/* Botão fixo — só com mesas já cadastradas: no estado vazio o próprio
          cartão de apresentação traz o botão, e os dois se sobreporiam. */}
      {canEdit && tables.length > 0 && (
        <div
          className="fixed inset-x-0 z-30 px-4"
          style={{ bottom: "calc(4.25rem + env(safe-area-inset-bottom))" }}
        >
          <div className="app-shell">
            <Button
              size="lg"
              block
              onClick={() => setForm({ open: true, table: null })}
              className="shadow-[0_12px_28px_-12px_rgba(15,146,80,0.9)]"
            >
              <Plus className="size-5" aria-hidden="true" />
              Adicionar mesa
            </Button>
          </div>
        </div>
      )}

      {/* Sheets */}
      <TableSheet
        open={form.open}
        table={form.table}
        suggestedName={suggestedName}
        onClose={() => setForm({ open: false, table: null })}
        onDelete={(table) => {
          setForm({ open: false, table: null });
          setConfirm(table);
        }}
      />

      <QrSheet
        open={qr.open}
        table={qr.table}
        tableUrl={qr.table ? urlFor(qr.table) : ""}
        onClose={() => setQr({ open: false, table: null })}
      />

      <ConfirmSheet
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title="Excluir mesa?"
        confirmLabel="Excluir mesa"
        description={
          confirm ? (
            <>
              <strong>{confirm.name}</strong> e o QR Code dela serão removidos. Se a mesa
              voltar, será preciso imprimir um código novo. Prefere apenas{" "}
              <strong>desativar</strong>?
            </>
          ) : null
        }
        onConfirm={handleDelete}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "brand" | "amber";
}) {
  return (
    <div className="rounded-xl border border-ink-200/70 bg-white px-2.5 py-2.5 text-center">
      <p
        className={cn(
          "text-xl font-semibold leading-none tabular-nums",
          tone === "brand" && "text-brand-700",
          tone === "amber" && "text-amber-600",
          tone === "neutral" && "text-ink-900",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[0.7rem] font-medium text-ink-500">{label}</p>
    </div>
  );
}

function EmptyState({ canEdit, onCreate }: { canEdit: boolean; onCreate: () => void }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-ink-300 bg-white px-5 py-8 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
        <Armchair className="size-6" aria-hidden="true" />
      </span>
      <h2 className="mt-3 text-lg font-semibold text-ink-900">Nenhuma mesa ainda</h2>
      <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-ink-500">
        Cadastre as mesas do salão. Cada uma recebe um QR Code próprio para o cliente
        abrir o cardápio e, depois, fazer o pedido.
      </p>
      {canEdit && (
        <Button size="lg" className="mt-5 w-full max-w-xs" onClick={onCreate}>
          <Plus className="size-5" aria-hidden="true" />
          Adicionar primeira mesa
        </Button>
      )}
    </div>
  );
}
