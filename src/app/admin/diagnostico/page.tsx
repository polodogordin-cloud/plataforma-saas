import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Gauge,
  HelpCircle,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { readDiagnostics, type Check, type CheckState } from "@/lib/diagnostics";
import { isPlatformOwner } from "@/lib/data/admin";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Diagnóstico" };
export const dynamic = "force-dynamic";

/**
 * Diagnóstico técnico da plataforma — Etapa 20.
 *
 * ─── Para quem é ───────────────────────────────────────────────────────────
 *
 * Para quem responde "está fora do ar?" no WhatsApp. Antes, essa resposta saía
 * de olhar o log da Vercel; agora sai de uma tela com estado por peça.
 *
 * ─── O que esta tela NÃO mostra ────────────────────────────────────────────
 *
 * Nenhum valor de configuração: nem URL do projeto, nem chave (pública ou não),
 * nem nome de bucket, nem mensagem crua de driver. O que aparece é o estado
 * (`up`/`down`/...) e uma frase em português. Se um dia for preciso ver o valor,
 * isso se faz no painel do provedor, com o login do provedor — não aqui, onde um
 * print de tela vira vazamento.
 *
 * A página vive dentro de `/admin`, então o layout já exigiu papel de
 * plataforma. O link fica em Ajustes, junto do resto da operação.
 */

const STATE_LABEL: Record<CheckState, string> = {
  up: "Funcionando",
  down: "Fora do ar",
  unconfigured: "Não configurado",
  disabled: "Desligado",
  degraded: "Degradado",
  unknown: "Não medido",
};

const STATE_TONE: Record<CheckState, string> = {
  up: "bg-brand-50 text-brand-800 border-brand-200",
  down: "bg-red-50 text-red-700 border-red-200",
  unconfigured: "bg-amber-50 text-amber-800 border-amber-200",
  disabled: "bg-ink-100 text-ink-600 border-ink-200",
  degraded: "bg-amber-50 text-amber-800 border-amber-200",
  unknown: "bg-ink-100 text-ink-600 border-ink-200",
};

function StateIcon({ state }: { state: CheckState }) {
  if (state === "up") return <CheckCircle2 className="size-5" aria-hidden="true" />;
  if (state === "down") return <XCircle className="size-5" aria-hidden="true" />;
  if (state === "unconfigured" || state === "degraded")
    return <AlertTriangle className="size-5" aria-hidden="true" />;
  if (state === "disabled") return <CircleSlash className="size-5" aria-hidden="true" />;
  return <HelpCircle className="size-5" aria-hidden="true" />;
}

function CheckRow({ check }: { check: Check }) {
  return (
    <li className="flex items-start gap-3 rounded-[var(--radius-card)] border border-ink-200 bg-white p-3.5">
      <span
        className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border ${STATE_TONE[check.state]}`}
      >
        <StateIcon state={check.state} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="text-sm font-semibold text-ink-900">{check.label}</p>
          <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-ink-400">
            {STATE_LABEL[check.state]}
          </span>
        </div>
        <p className="mt-0.5 text-[0.82rem] leading-relaxed text-ink-600">{check.detail}</p>
      </div>
    </li>
  );
}

export default async function AdminDiagnosticsPage() {
  const [report, owner] = await Promise.all([readDiagnostics(), isPlatformOwner()]);

  const healthy = report.ok;
  const problems = report.checks.filter(
    (check) => check.state === "down" || check.state === "unconfigured",
  );

  return (
    <>
      <AdminHeader title="Diagnóstico" subtitle="Estado técnico da plataforma" backHref="/admin/configuracoes" />

      <main className="app-shell space-y-4 px-4 py-4">
        {/* Resumo: a primeira coisa que a pessoa precisa saber. */}
        <section
          aria-labelledby="resumo-diagnostico"
          className={`rounded-[var(--radius-card)] border p-4 ${
            healthy ? "border-brand-200 bg-brand-50" : "border-red-200 bg-red-50"
          }`}
        >
          <div className="flex items-start gap-3">
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                healthy ? "bg-brand-600 text-white" : "bg-red-600 text-white"
              }`}
            >
              <Gauge className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 id="resumo-diagnostico" className="text-base font-semibold text-ink-900">
                {healthy ? "Plataforma operando normalmente" : "Há peça fora do ar"}
              </h1>
              <p className="mt-1 text-[0.85rem] leading-relaxed text-ink-700">
                {healthy
                  ? "Banco, autenticação e ambiente responderam. As demais peças estão listadas abaixo."
                  : `${problems.length} peça(s) exigem atenção: ${problems
                      .map((p) => p.label)
                      .join(", ")}.`}
              </p>
            </div>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-2 text-[0.78rem]">
            <div className="rounded-xl bg-white/70 px-3 py-2">
              <dt className="text-ink-500">Ambiente</dt>
              <dd className="font-semibold text-ink-900">{report.env}</dd>
            </div>
            <div className="rounded-xl bg-white/70 px-3 py-2">
              <dt className="text-ink-500">Versão</dt>
              <dd className="font-semibold text-ink-900">{report.version}</dd>
            </div>
            <div className="rounded-xl bg-white/70 px-3 py-2">
              <dt className="text-ink-500">Commit</dt>
              <dd className="font-mono font-semibold text-ink-900">{report.revision ?? "—"}</dd>
            </div>
            <div className="rounded-xl bg-white/70 px-3 py-2">
              <dt className="text-ink-500">Verificado</dt>
              <dd className="font-semibold text-ink-900">{formatDate(report.checkedAt)}</dd>
            </div>
          </dl>
        </section>

        {/* Uma linha por peça. */}
        <section aria-labelledby="pecas-diagnostico">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 id="pecas-diagnostico" className="text-sm font-semibold text-ink-700">
              Peças verificadas
            </h2>
            <Link
              href="/admin/diagnostico"
              className="tap-target inline-flex items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-ink-600 hover:bg-ink-100"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Verificar de novo
            </Link>
          </div>
          <ul className="space-y-2">
            {report.checks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </ul>
        </section>

        {/* Rodapé honesto sobre o escopo da medição. */}
        <section className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
            <ShieldCheck className="size-4 text-brand-600" aria-hidden="true" />
            O que este painel não mostra
          </h2>
          <ul className="mt-2 space-y-1.5 text-[0.82rem] leading-relaxed text-ink-600">
            <li>
              <strong className="font-semibold text-ink-800">Nenhum segredo.</strong> Nem URL, nem
              chave, nem nome de bucket. Um print desta tela não entrega acesso a nada.
            </li>
            <li>
              <strong className="font-semibold text-ink-800">Realtime fica como “não medido”.</strong>{" "}
              Provar entrega exigiria abrir canal e receber evento — caro e com efeito colateral num
              endpoint que o monitor bate a cada minuto.
            </li>
            <li>
              <strong className="font-semibold text-ink-800">Webhooks aparecem desligados</strong>{" "}
              enquanto não houver provedor com entrega assíncrona. A confirmação de pagamento hoje é
              manual, e a tela diz isso em vez de fingir um “OK”.
            </li>
          </ul>
        </section>

        {/* Endpoint público, para quem quiser ligar um monitor. */}
        <section className="rounded-[var(--radius-card)] border border-ink-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-ink-900">Monitorar de fora</h2>
          <p className="mt-1 text-[0.82rem] leading-relaxed text-ink-600">
            <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[0.78rem]">
              GET /api/health
            </code>{" "}
            responde <code className="font-mono">200</code> quando está tudo bem e{" "}
            <code className="font-mono">503</code> quando uma peça essencial cai. Em produção, o
            relatório detalhado exige <code className="font-mono">HEALTH_CHECK_SECRET</code>; sem
            ele, a resposta traz só o resumo.
          </p>
          {owner && (
            <p className="mt-2 text-[0.78rem] text-ink-500">
              Você é dono da plataforma: o segredo do health check é configurado na Vercel, em
              variáveis de ambiente. Ele não é exibido aqui.
            </p>
          )}
        </section>
      </main>
    </>
  );
}
