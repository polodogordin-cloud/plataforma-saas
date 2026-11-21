"use client";

import { useState, useTransition } from "react";
import { Check, Info, Plus, Trash2 } from "lucide-react";
import {
  deletePrintProfile,
  deletePrinter,
  savePrintProfile,
  savePrintSettings,
  savePrinter,
  seedPrintProfiles,
} from "@/actions/printing";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { CollapsibleSection, InfoRow, SegmentedChoice } from "@/components/printing/print-settings-section";
import {
  FOOTER_NOTE_MAX,
  PAPER_SPECS,
  PRINTER_IDENTIFIER_MAX,
  PRINTER_NAME_MAX,
  PROFILE_NAME_MAX,
  normalizeCopies,
} from "@/lib/printing";
import {
  PRINT_MODE_LABEL,
  PRINT_PROFILE_KIND_LABEL,
  PRINT_PROVIDER_LABEL,
  PRINT_PROVIDER_SUPPORT,
  type PaperWidth,
  type PrintConfig,
  type PrintProfile,
  type PrintProfileKind,
  type PrintProviderKind,
  type PrintSettings,
  type Printer,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Configuração de impressão — Etapa 18.
 *
 * Estrutura da tela, e por quê:
 *
 *   1. **Aviso de realidade primeiro.** Antes de qualquer campo, o dono lê o
 *      que o navegador consegue e não consegue. Sem isso ele configura tudo,
 *      toca em imprimir e conclui que o produto está quebrado — quando o que
 *      falta é o driver da térmica no aparelho.
 *   2. **Seções expansíveis** (modo/papel, o que imprimir, perfis,
 *      impressoras). No celular cada uma ocupa uma tela; empilhadas abertas
 *      viram um formulário de rolagem infinita.
 *   3. **Nada de salvar escondido.** Os interruptores gravam no toque (é o que
 *      se espera de um switch), e cada seção mostra o próprio resultado. O
 *      botão "Salvar" existe só para o texto do rodapé e as cópias, que são
 *      digitação.
 *
 * Toda escrita passa pelas Server Actions, que validam de novo e chamam RPC
 * com guarda de admin. `can_configure: false` desabilita os controles aqui, mas
 * é o banco que recusa.
 */

type Feedback = { ok: boolean; text: string } | null;

export function PrintConfigForm({ initialConfig }: { initialConfig: PrintConfig }) {
  const [config, setConfig] = useState(initialConfig);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();

  const { settings, profiles, printers, can_configure: canConfigure } = config;
  const editable = canConfigure && !pending;

  /* ------------------------------------------------------------- settings */

  function updateSettings(patch: Partial<PrintSettings>) {
    const next = { ...settings, ...patch };
    setConfig((current) => ({ ...current, settings: next }));

    startTransition(async () => {
      const result = await savePrintSettings(next);
      if (result.ok === false) {
        setFeedback({ ok: false, text: result.error });
        return;
      }
      setConfig(result.data);
      setFeedback({ ok: true, text: result.message ?? "Configuração salva." });
    });
  }

  /* ------------------------------------------------------------- profiles */

  function createProfile(input: {
    name: string;
    kind: PrintProfileKind;
    paper_width: PaperWidth;
    copies: number;
  }) {
    startTransition(async () => {
      const result = await savePrintProfile({
        name: input.name,
        kind: input.kind,
        paper_width: input.paper_width,
        copies: normalizeCopies(input.copies),
        is_active: true,
        sort_order: profiles.length,
      });
      if (result.ok === false) {
        setFeedback({ ok: false, text: result.error });
        return;
      }
      setConfig(result.data);
      setFeedback({ ok: true, text: result.message ?? "Perfil criado." });
    });
  }

  function toggleProfile(profile: PrintProfile) {
    startTransition(async () => {
      const result = await savePrintProfile({
        id: profile.id,
        name: profile.name,
        kind: profile.kind,
        paper_width: profile.paper_width,
        copies: profile.copies,
        is_active: !profile.is_active,
        sort_order: profile.sort_order,
      });
      if (result.ok === false) {
        setFeedback({ ok: false, text: result.error });
        return;
      }
      setConfig(result.data);
      setFeedback({
        ok: true,
        text: profile.is_active ? `${profile.name} desativado.` : `${profile.name} ativado.`,
      });
    });
  }

  function removeProfile(profile: PrintProfile) {
    startTransition(async () => {
      const result = await deletePrintProfile(profile.id);
      if (result.ok === false) {
        setFeedback({ ok: false, text: result.error });
        return;
      }
      setConfig(result.data);
      setFeedback({ ok: true, text: result.message ?? "Perfil removido." });
    });
  }

  function seedProfiles() {
    startTransition(async () => {
      const result = await seedPrintProfiles();
      if (result.ok === false) {
        setFeedback({ ok: false, text: result.error });
        return;
      }
      setConfig(result.data);
      setFeedback({ ok: true, text: result.message ?? "Perfis criados." });
    });
  }

  /* ------------------------------------------------------------- printers */

  function savePrinterAction(input: {
    id?: string | null;
    profile_id: string | null;
    name: string;
    provider: PrintProviderKind;
    identifier: string;
    paper_width: PaperWidth;
    is_default: boolean;
    is_active: boolean;
    notes: string;
  }) {
    startTransition(async () => {
      const result = await savePrinter({
        ...input,
        id: input.id ?? null,
      });
      if (result.ok === false) {
        setFeedback({ ok: false, text: result.error });
        return;
      }
      setConfig(result.data);
      setFeedback({ ok: true, text: result.message ?? "Impressora salva." });
    });
  }

  function removePrinter(printer: Printer) {
    startTransition(async () => {
      const result = await deletePrinter(printer.id);
      if (result.ok === false) {
        setFeedback({ ok: false, text: result.error });
        return;
      }
      setConfig(result.data);
      setFeedback({ ok: true, text: result.message ?? "Impressora removida." });
    });
  }

  return (
    <div className="space-y-4">
      {!canConfigure && (
        <FormAlert tone="info">
          Só administradores e gerentes podem alterar a impressão. Você pode ver a configuração
          atual.
        </FormAlert>
      )}

      {feedback && (
        <FormAlert tone={feedback.ok ? "success" : "error"}>{feedback.text}</FormAlert>
      )}

      {/* ------------------------------------------------------- 1. realidade */}
      <section className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-sky-900">
          <Info className="size-4 shrink-0" aria-hidden="true" />
          O que o navegador consegue fazer
        </h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-sky-900/90">
          <li>
            • O Menuvo monta o cupom no tamanho do papel e abre a janela de impressão do
            aparelho. <strong>Você escolhe a térmica nessa janela.</strong>
          </li>
          <li>
            • A impressora precisa estar instalada no aparelho (celular, tablet ou computador),
            com driver. Sem isso a janela abre e não há para onde imprimir.
          </li>
          <li>
            • O navegador não confirma se o papel saiu. Por isso o histórico registra
            <strong> “solicitada”</strong>, nunca “impressa”.
          </li>
          <li>
            • Impressão automática sem toque exige um bridge local ou um serviço de impressão —
            ainda não disponíveis.
          </li>
        </ul>
      </section>

      {/* ------------------------------------------------- 2. modo e papel */}
      <CollapsibleSection
        title="Modo e papel"
        description={`${PRINT_MODE_LABEL[settings.mode]} · ${PAPER_SPECS[settings.default_paper_width].label}`}
        defaultOpen
        badge={
          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-ink-600">
            {PRINT_MODE_LABEL[settings.mode]}
          </span>
        }
      >
        <SegmentedChoice
          label="Como imprimir"
          hint="Manual: você toca em “Imprimir pedido”. Automática: o painel tenta abrir a janela quando o pedido é aceito."
          value={settings.mode}
          disabled={!editable}
          onChange={(mode) => updateSettings({ mode })}
          options={[
            {
              value: "manual",
              label: "Manual",
              description: "Imprime quando quiser",
            },
            {
              value: "auto",
              label: "Automática",
              description: "Ao aceitar o pedido",
            },
          ]}
        />

        {settings.mode === "auto" && (
          <FormAlert tone="info">
            No modo automático o navegador ainda pode bloquear a abertura da janela sem um toque.
            Ao aceitar o pedido, confirme a janela — ou mantenha o botão “Imprimir pedido” à mão.
          </FormAlert>
        )}

        <SegmentedChoice
          label="Largura do papel"
          hint="Escolha o que está escrito na bobina. 58mm imprime 32 colunas por linha; 80mm, 48."
          value={settings.default_paper_width}
          disabled={!editable}
          onChange={(default_paper_width) => updateSettings({ default_paper_width })}
          options={[
            {
              value: "58" as PaperWidth,
              label: "58mm",
              description: `${PAPER_SPECS["58"].printableMm}mm úteis · ${PAPER_SPECS["58"].columns} colunas`,
            },
            {
              value: "80" as PaperWidth,
              label: "80mm",
              description: `${PAPER_SPECS["80"].printableMm}mm úteis · ${PAPER_SPECS["80"].columns} colunas`,
            },
          ]}
        />
      </CollapsibleSection>

      {/* -------------------------------------------- 3. o que imprimir */}
      <CollapsibleSection
        title="O que imprimir"
        description="Pedidos, comandas, cozinha e balcão"
        defaultOpen={false}
      >
        <div className="divide-y divide-ink-100">
          <ToggleRow
            label="Impressão de pedidos"
            description="O pedido como a cozinha precisa: itens, quantidades e observações."
            checked={settings.print_orders}
            disabled={!editable}
            onChange={(value) => updateSettings({ print_orders: value })}
          />
          <ToggleRow
            label="Impressão de comandas"
            description="Via curta para o cliente conferir, com preços."
            checked={settings.print_tickets}
            disabled={!editable}
            onChange={(value) => updateSettings({ print_tickets: value })}
          />
          <ToggleRow
            label="Impressão para cozinha"
            description="Destino padrão do painel da cozinha."
            checked={settings.print_kitchen}
            disabled={!editable}
            onChange={(value) => updateSettings({ print_kitchen: value })}
          />
          <ToggleRow
            label="Impressão para balcão"
            description="Destino do pedido fechado no balcão."
            checked={settings.print_counter}
            disabled={!editable}
            onChange={(value) => updateSettings({ print_counter: value })}
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((copies) => (
            <button
              key={copies}
              type="button"
              aria-pressed={settings.copies === copies}
              disabled={!editable}
              onClick={() => updateSettings({ copies })}
              className={cn(
                "min-h-11 rounded-xl border text-sm font-semibold transition-colors",
                settings.copies === copies
                  ? "border-brand-600 bg-brand-50 text-brand-800"
                  : "border-ink-200 bg-white text-ink-700",
              )}
            >
              {copies} {copies === 1 ? "via" : "vias"}
            </button>
          ))}
        </div>

        <FooterNoteField
          key={settings.footer_note ?? ""}
          defaultValue={settings.footer_note ?? ""}
          disabled={!editable}
          onSave={(footer_note) => updateSettings({ footer_note })}
        />
      </CollapsibleSection>

      {/* ------------------------------------------------------ 4. perfis */}
      <CollapsibleSection
        title="Perfis de impressão"
        description={
          profiles.length === 0
            ? "Nenhum perfil ainda"
            : `${profiles.length} ${profiles.length === 1 ? "perfil" : "perfis"}`
        }
        badge={
          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[0.65rem] font-semibold tabular-nums text-ink-600">
            {profiles.length}
          </span>
        }
      >
        <p className="text-xs leading-relaxed text-ink-500">
          Perfis são os destinos da casa: cozinha, balcão, bar, caixa. Cada um pode ter papel e
          cópias próprios. Hoje eles organizam a impressão; dividir itens por perfil (bebida no bar)
          é a próxima evolução.
        </p>

        {profiles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-300 bg-ink-50/60 px-4 py-5 text-center">
            <p className="text-sm font-medium text-ink-700">Nenhum perfil configurado</p>
            <p className="mt-1 text-xs text-ink-500">
              Crie os quatro padrões de uma vez e ajuste depois.
            </p>
            <Button
              size="md"
              className="mt-3"
              disabled={!editable}
              onClick={seedProfiles}
              loading={pending}
            >
              <Plus className="size-4" aria-hidden="true" />
              Criar perfis padrão
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {profiles.map((profile) => (
              <li
                key={profile.id}
                className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink-900">
                    {profile.name}
                    {!profile.is_active && (
                      <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-ink-500">
                        off
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[0.7rem] text-ink-500">
                    {PRINT_PROFILE_KIND_LABEL[profile.kind]} ·{" "}
                    {PAPER_SPECS[profile.paper_width].label} · {profile.copies}{" "}
                    {profile.copies === 1 ? "via" : "vias"}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => toggleProfile(profile)}
                  className="tap-target shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-100 disabled:opacity-50"
                >
                  {profile.is_active ? "Desativar" : "Ativar"}
                </button>
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => removeProfile(profile)}
                  aria-label={`Remover perfil ${profile.name}`}
                  className="tap-target grid size-9 shrink-0 place-items-center rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <NewProfileForm disabled={!editable} pending={pending} onCreate={createProfile} />
      </CollapsibleSection>

      {/* -------------------------------------------------- 5. impressoras */}
      <CollapsibleSection
        title="Impressoras"
        description={
          printers.length === 0
            ? "Nenhuma impressora cadastrada"
            : `${printers.length} ${printers.length === 1 ? "impressora" : "impressoras"}`
        }
        badge={
          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[0.65rem] font-semibold tabular-nums text-ink-600">
            {printers.length}
          </span>
        }
      >
        {printers.length === 0 && (
          <p className="rounded-xl bg-ink-50 px-3.5 py-3 text-xs leading-relaxed text-ink-600">
            Cadastrar a impressora serve para anotar o nome e a conexão dela — o navegador não usa
            esse dado para escolher a térmica; quem escolhe é a janela do sistema. Com um bridge
            local, o identificador abaixo passa a ser usado de verdade.
          </p>
        )}

        <ul className="space-y-2">
          {printers.map((printer) => (
            <li
              key={printer.id}
              className="rounded-xl border border-ink-200 bg-white px-3 py-2.5"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink-900">
                    {printer.name}
                    {printer.is_default && (
                      <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-brand-800">
                        padrão
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[0.7rem] leading-snug text-ink-500">
                    {PRINT_PROVIDER_LABEL[printer.provider]} ·{" "}
                    {PAPER_SPECS[printer.paper_width].label}
                    {printer.identifier ? ` · ${printer.identifier}` : ""}
                  </p>
                  {PRINT_PROVIDER_SUPPORT[printer.provider] === "planned" && (
                    <p className="mt-1 text-[0.68rem] font-medium text-amber-700">
                      Provedor ainda não disponível — o cadastro fica pronto para quando existir.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => removePrinter(printer)}
                  aria-label={`Remover impressora ${printer.name}`}
                  className="tap-target grid size-9 shrink-0 place-items-center rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>

        <NewPrinterForm
          profiles={profiles}
          disabled={!editable}
          pending={pending}
          onSubmit={savePrinterAction}
        />
      </CollapsibleSection>

      {/* ---------------------------------------------------- 6. resumo */}
      <section className="rounded-2xl border border-ink-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-ink-900">Como está hoje</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <InfoRow label="Modo" value={PRINT_MODE_LABEL[settings.mode]} />
          <InfoRow label="Papel" value={PAPER_SPECS[settings.default_paper_width].label} />
          <InfoRow label="Cópias" value={`${settings.copies}`} />
          <InfoRow label="Perfis ativos" value={`${profiles.filter((p) => p.is_active).length}`} />
        </dl>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Peças                                                                      */
/* -------------------------------------------------------------------------- */

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="py-3">
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        label={label}
        description={description}
      />
    </div>
  );
}

function FooterNoteField({
  defaultValue,
  disabled,
  onSave,
}: {
  defaultValue: string;
  disabled?: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="space-y-2">
      <Textarea
        label="Rodapé do cupom"
        name="footer_note"
        rows={2}
        maxLength={FOOTER_NOTE_MAX}
        placeholder="Obrigado pela preferência!"
        hint={`Até ${FOOTER_NOTE_MAX} caracteres. Aparece no fim de cada cupom.`}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button
        size="md"
        variant="secondary"
        block
        disabled={disabled || value === defaultValue}
        onClick={() => onSave(value)}
      >
        <Check className="size-4" aria-hidden="true" />
        Salvar rodapé
      </Button>
    </div>
  );
}

function NewProfileForm({
  disabled,
  pending,
  onCreate,
}: {
  disabled?: boolean;
  pending: boolean;
  onCreate: (input: {
    name: string;
    kind: PrintProfileKind;
    paper_width: PaperWidth;
    copies: number;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PrintProfileKind>("kitchen");
  const [width, setWidth] = useState<PaperWidth>("80");

  if (!open) {
    return (
      <Button size="md" variant="secondary" block disabled={disabled} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        Adicionar perfil
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-ink-200 bg-ink-50/60 p-3">
      <Field
        label="Nome do perfil"
        name="profile_name"
        maxLength={PROFILE_NAME_MAX}
        placeholder="Cozinha quente"
        value={name}
        disabled={disabled}
        onChange={(event) => setName(event.target.value)}
      />

      <div className="space-y-1.5">
        <label htmlFor="profile-kind" className="block text-sm font-medium text-ink-700">
          Tipo
        </label>
        <select
          id="profile-kind"
          value={kind}
          disabled={disabled}
          onChange={(event) => setKind(event.target.value as PrintProfileKind)}
          className="min-h-12 w-full rounded-xl border border-ink-200 bg-white px-3 text-[0.95rem] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        >
          {(Object.keys(PRINT_PROFILE_KIND_LABEL) as PrintProfileKind[]).map((option) => (
            <option key={option} value={option}>
              {PRINT_PROFILE_KIND_LABEL[option]}
            </option>
          ))}
        </select>
      </div>

      <SegmentedChoice
        label="Papel"
        value={width}
        disabled={disabled}
        onChange={setWidth}
        options={[
          { value: "58" as PaperWidth, label: "58mm" },
          { value: "80" as PaperWidth, label: "80mm" },
        ]}
      />

      <div className="flex gap-2">
        <Button
          size="md"
          className="min-w-0 flex-1"
          disabled={disabled || name.trim().length === 0}
          loading={pending}
          onClick={() => {
            onCreate({ name, kind, paper_width: width, copies: 1 });
            setOpen(false);
            setName("");
          }}
        >
          Criar perfil
        </Button>
        <Button size="md" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function NewPrinterForm({
  profiles,
  disabled,
  pending,
  onSubmit,
}: {
  profiles: PrintProfile[];
  disabled?: boolean;
  pending: boolean;
  onSubmit: (input: {
    profile_id: string | null;
    name: string;
    provider: PrintProviderKind;
    identifier: string;
    paper_width: PaperWidth;
    is_default: boolean;
    is_active: boolean;
    notes: string;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<PrintProviderKind>("browser");
  const [identifier, setIdentifier] = useState("");
  const [profileId, setProfileId] = useState<string>("");
  const [width, setWidth] = useState<PaperWidth>("80");

  if (!open) {
    return (
      <Button size="md" variant="secondary" block disabled={disabled} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        Adicionar impressora
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-ink-200 bg-ink-50/60 p-3">
      <Field
        label="Nome da impressora"
        name="printer_name"
        maxLength={PRINTER_NAME_MAX}
        placeholder="Térmica da cozinha"
        value={name}
        disabled={disabled}
        onChange={(event) => setName(event.target.value)}
      />

      <div className="space-y-1.5">
        <label htmlFor="printer-provider" className="block text-sm font-medium text-ink-700">
          Como o app alcança a impressora
        </label>
        <select
          id="printer-provider"
          value={provider}
          disabled={disabled}
          onChange={(event) => setProvider(event.target.value as PrintProviderKind)}
          className="min-h-12 w-full rounded-xl border border-ink-200 bg-white px-3 text-[0.95rem] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
        >
          {(Object.keys(PRINT_PROVIDER_LABEL) as PrintProviderKind[]).map((option) => (
            <option key={option} value={option}>
              {PRINT_PROVIDER_LABEL[option]}
              {PRINT_PROVIDER_SUPPORT[option] === "planned" ? " (em breve)" : ""}
            </option>
          ))}
        </select>
        <p className="text-[0.7rem] leading-snug text-ink-500">
          {PRINT_PROVIDER_SUPPORT[provider] === "planned"
            ? "Ainda não disponível. O cadastro guarda os dados para quando o provedor existir."
            : "Funciona pela janela de impressão do sistema."}
        </p>
      </div>

      {provider !== "browser" && (
        <Field
          label="Identificador"
          name="printer_identifier"
          maxLength={PRINTER_IDENTIFIER_MAX}
          placeholder="192.168.0.50:9100 ou nome da fila"
          hint="IP:porta, fila do sistema ou identificador do bridge."
          value={identifier}
          disabled={disabled}
          onChange={(event) => setIdentifier(event.target.value)}
        />
      )}

      {profiles.length > 0 && (
        <div className="space-y-1.5">
          <label htmlFor="printer-profile" className="block text-sm font-medium text-ink-700">
            Perfil
          </label>
          <select
            id="printer-profile"
            value={profileId}
            disabled={disabled}
            onChange={(event) => setProfileId(event.target.value)}
            className="min-h-12 w-full rounded-xl border border-ink-200 bg-white px-3 text-[0.95rem] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
          >
            <option value="">Sem perfil fixo</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <SegmentedChoice
        label="Papel"
        value={width}
        disabled={disabled}
        onChange={setWidth}
        options={[
          { value: "58" as PaperWidth, label: "58mm" },
          { value: "80" as PaperWidth, label: "80mm" },
        ]}
      />

      <div className="flex gap-2">
        <Button
          size="md"
          className="min-w-0 flex-1"
          disabled={disabled || name.trim().length === 0}
          loading={pending}
          onClick={() => {
            onSubmit({
              profile_id: profileId || null,
              name,
              provider,
              identifier,
              paper_width: width,
              is_default: false,
              is_active: true,
              notes: "",
            });
            setOpen(false);
            setName("");
            setIdentifier("");
          }}
        >
          Adicionar
        </Button>
        <Button size="md" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
