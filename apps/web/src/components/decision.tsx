"use client";

import { useState } from "react";
import { Check, ChevronDown, CircleAlert, X } from "lucide-react";
import { INTENT_LABEL, type Decision, type DecisionOutcome } from "@/lib/types";

// Transparência: acima de cada resposta, as ações do agent (como no protótipo).
// Um clique abre o detalhe da decisão: o que entendeu, o que fez, com que
// confiança, por quê, cada ferramenta executada e o custo do turno.

const OUTCOME_LABEL: Record<DecisionOutcome, string> = {
  respondeu: "Respondeu",
  transferiu: "Transferiu para analista",
  baixa_confianca: "Transferiu por confiança baixa",
  sistema_indisponivel: "Sistema de chamados indisponível",
  erro: "Falha ao responder",
  confirmacao_direta: "Ação direta do funcionário",
};

export function confidenceTone(c: number) {
  if (c >= 0.8) return { bar: "bg-success", text: "text-success-text" };
  if (c >= 0.6) return { bar: "bg-warning", text: "text-warning-text" };
  return { bar: "bg-danger", text: "text-danger-text" };
}

export function StepLabels({ labels, live }: { labels: string[]; live?: boolean }) {
  return (
    <>
      {labels.map((label, i) => (
        <span key={`${label}-${i}`} className="flex items-center gap-[5px] text-[12.5px] text-ink-3">
          <Check size={12} strokeWidth={2.5} />
          {label}
        </span>
      ))}
      {live && (
        <span className="flex items-center gap-[3px] text-ink-3" aria-label="pensando">
          <span className="typing-dot size-1 rounded-full bg-ink-3" />
          <span className="typing-dot size-1 rounded-full bg-ink-3" />
          <span className="typing-dot size-1 rounded-full bg-ink-3" />
        </span>
      )}
    </>
  );
}

/** Linha "Nexo Assist ✓ consultou… ✓ buscou…" com o detalhe expansível. */
export function AgentStatusLine({
  decision,
  liveLabels,
  name = "Nexo Assist",
  tone = "light",
}: {
  decision?: Decision | null;
  liveLabels?: string[];
  name?: string;
  tone?: "light" | "console";
}) {
  const [open, setOpen] = useState(false);
  const labels = liveLabels ?? decision?.steps.flatMap((s) => s.labels) ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`text-[12.5px] font-semibold ${tone === "console" ? "text-ink-2" : ""}`}>{name}</span>
        <StepLabels labels={labels} live={!!liveLabels} />
        {decision && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-primary-text hover:bg-primary-soft"
          >
            {open ? "ocultar decisão" : "ver decisão"}
            <ChevronDown size={12} className={open ? "rotate-180" : ""} />
          </button>
        )}
      </div>
      {open && decision && <DecisionDetails decision={decision} />}
    </div>
  );
}

export function DecisionDetails({ decision }: { decision: Decision }) {
  const pct = Math.round(decision.confidence * 100);
  const tone = confidenceTone(decision.confidence);
  return (
    <div className="w-full max-w-[600px] rounded-xl border border-violet/25 bg-violet-soft p-3.5 text-[13px]">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-ink-3">Entendeu</dt>
        <dd>{decision.understanding}</dd>
        <dt className="text-ink-3">Intenção</dt>
        <dd>{INTENT_LABEL[decision.intent]}</dd>
        <dt className="text-ink-3">Ação</dt>
        <dd>{decision.plannedAction}</dd>
        <dt className="text-ink-3">Confiança</dt>
        <dd className="flex items-center gap-2">
          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-ink/10">
            <span className={`block h-full ${tone.bar}`} style={{ width: `${pct}%` }} />
          </span>
          <span className={`font-data font-medium ${tone.text}`}>{pct}%</span>
        </dd>
        <dt className="text-ink-3">Por quê</dt>
        <dd>{decision.reason}</dd>
        {decision.missingInfo.length > 0 && (
          <>
            <dt className="text-ink-3">Faltava</dt>
            <dd>{decision.missingInfo.join(", ")}</dd>
          </>
        )}
        <dt className="text-ink-3">Resultado</dt>
        <dd>{OUTCOME_LABEL[decision.outcome]}</dd>
      </dl>

      {decision.steps.length > 0 && (
        <ol className="mt-3 flex flex-col gap-1.5 border-t border-violet/20 pt-3">
          {decision.steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              {s.ok ? (
                <Check size={14} className="mt-0.5 shrink-0 text-success-text" />
              ) : (
                <X size={14} className="mt-0.5 shrink-0 text-danger-text" />
              )}
              <span className="min-w-0">
                <span className="font-data text-[12px] text-violet-text">{s.tool}</span>{" "}
                <span className="text-ink-2">{s.summary}</span> <span className="text-[11.5px] text-ink-3">{s.durationMs} ms</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-3 flex flex-wrap gap-x-3 border-t border-violet/20 pt-2.5 text-[11.5px] text-ink-3">
        {decision.model ? (
          <>
            <span>modelo {decision.model}</span>
            <span>
              {decision.inputTokens} tokens de entrada · {decision.outputTokens} de saída
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1">
            <CircleAlert size={12} /> sem chamada ao modelo
          </span>
        )}
        <span>{(decision.latencyMs / 1000).toFixed(1)} s</span>
      </p>
    </div>
  );
}
