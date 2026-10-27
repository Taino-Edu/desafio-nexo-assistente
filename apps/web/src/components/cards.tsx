"use client";

import { ArrowRightLeft, Headset } from "lucide-react";
import { AFFECTED_LABEL, PRIORITY_LABEL, STATUS_LABEL, type Priority } from "@nexo/shared";
import type { Card, Draft, TicketSummary } from "@/lib/types";
import { ago, dateTime, shortDate, time, PRIORITY_DOT, STATUS_DOT, STATUS_TEXT } from "@/lib/format";

// Cartões que o agent mostra no chat (Telas 2 e 3 do protótipo).

const cardShell = "w-full overflow-hidden rounded-2xl border border-ink/9 bg-paper";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[12.5px] text-ink-3">{label}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-[14.5px] font-medium">{children}</span>
    </div>
  );
}

function PriorityValue({ priority, due }: { priority: Priority; due?: string | null }) {
  return (
    <>
      <span className={`size-1.5 rounded-full ${PRIORITY_DOT[priority]}`} />
      {PRIORITY_LABEL[priority]}
      {due && <span className="text-[13.5px] font-normal text-ink-3">· resposta até {due}</span>}
    </>
  );
}

export function TicketCard({ ticket }: { ticket: TicketSummary }) {
  return (
    <div className={cardShell}>
      <div className="flex flex-col gap-1.5 px-[18px] pt-4 pb-3.5">
        <div className="flex items-center gap-2 pb-0.5 text-[12.5px] text-ink-3">
          <span className="font-medium">Chamado</span>
          <span className="size-[3px] rounded-full bg-rule" />
          <span className="font-data">{ticket.id}</span>
          <span className="flex-1" />
          <span className={`flex items-center gap-1.5 font-medium ${STATUS_TEXT[ticket.status]}`}>
            <span className={`size-1.5 rounded-full ${STATUS_DOT[ticket.status]}`} />
            {STATUS_LABEL[ticket.status]}
          </span>
        </div>
        <p className="text-lg leading-tight font-semibold tracking-[-0.2px]">{ticket.title}</p>
        <p className="text-[13.5px] leading-normal text-ink-2">{ticket.description}</p>
      </div>
      <div className="px-[18px] pb-4">
        <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-rule pt-3">
          <Field label="Categoria">{ticket.subcategory ? `${ticket.category} › ${ticket.subcategory}` : ticket.category}</Field>
          <Field label="Prioridade">
            <PriorityValue priority={ticket.priority} />
          </Field>
          <Field label="Aberto em">{dateTime(ticket.createdAt)}</Field>
          <Field label="Última atualização">
            <span className={ticket.overdue ? "text-danger-text" : ""}>{ago(ticket.updatedAt)}</span>
            {ticket.overdue ? (
              <span className="text-[13.5px] font-normal text-ink-3">· prazo vencido</span>
            ) : ticket.dueAt ? (
              <span className="text-[13.5px] font-normal text-ink-3">· próxima até {dateTime(ticket.dueAt)}</span>
            ) : null}
          </Field>
        </div>
      </div>
    </div>
  );
}

export function TicketListCard({
  tickets,
  selectable,
  selectedId,
  disabled,
  onSelect,
}: {
  tickets: TicketSummary[];
  selectable: boolean;
  selectedId?: string | null;
  disabled?: boolean;
  onSelect?: (t: TicketSummary) => void;
}) {
  return (
    <div className={cardShell} role={selectable ? "radiogroup" : "list"}>
      {tickets.map((t, i) => {
        const selected = selectedId === t.id;
        const Row = selectable && !disabled ? "button" : "div";
        return (
          <Row
            key={t.id}
            {...(Row === "button" ? { type: "button" as const, onClick: () => onSelect?.(t), role: "radio", "aria-checked": selected } : {})}
            className={`flex min-h-[46px] w-full items-center gap-3.5 px-4 py-2 text-left ${i > 0 ? "border-t border-rule" : ""} ${
              selected ? "bg-cta/4" : Row === "button" ? "hover:bg-desk" : ""
            }`}
          >
            {selectable && (
              <span className={`grid size-4 shrink-0 place-items-center rounded-full border bg-paper ${selected ? "border-cta" : "border-ink/20"}`}>
                {selected && <span className="size-2 rounded-full bg-cta" />}
              </span>
            )}
            <span className="w-[74px] shrink-0 font-data text-[12.5px] font-medium text-ink-3">{t.id}</span>
            <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{t.title}</span>
            <span className="hidden shrink-0 items-center gap-1.5 text-[12.5px] text-ink-3 sm:flex">
              <span className={`size-1.5 rounded-full ${t.overdue ? "bg-danger" : STATUS_DOT[t.status]}`} />
              {t.overdue ? "Prazo vencido" : STATUS_LABEL[t.status]}
            </span>
            <span className="w-11 shrink-0 text-right text-[12.5px] text-ink-3">{shortDate(t.createdAt)}</span>
          </Row>
        );
      })}
    </div>
  );
}

export function DraftCard({
  draft,
  busy,
  disabled,
  onConfirm,
  onEdit,
  onCancel,
}: {
  draft: Draft;
  busy?: boolean;
  disabled?: boolean;
  onConfirm?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
}) {
  const kindLabel = draft.kind === "criar" ? "Novo chamado" : draft.kind === "reabrir" ? `Reabrir ${draft.ticketId}` : `Complementar ${draft.ticketId}`;
  const state = {
    pendente: { dot: "bg-warning", text: "text-warning-text", label: "Aguardando confirmação" },
    confirmado: { dot: "bg-success", text: "text-success-text", label: "Confirmado" },
    cancelado: { dot: "bg-ink-3", text: "text-ink-3", label: "Cancelado" },
    substituido: { dot: "bg-ink-3", text: "text-ink-3", label: "Substituído por outro rascunho" },
  }[draft.status];
  const pending = draft.status === "pendente" && !disabled;

  return (
    <div className={cardShell}>
      <div className="flex flex-col gap-1.5 px-[18px] pt-4 pb-3.5">
        <div className="flex items-center gap-2 pb-0.5 text-[12.5px] text-ink-3">
          <span className="font-medium">{kindLabel}</span>
          <span className="size-[3px] rounded-full bg-rule" />
          <span>Rascunho {draft.id}</span>
          <span className="flex-1" />
          <span className={`flex items-center gap-1.5 font-medium ${state.text}`}>
            <span className={`size-1.5 rounded-full ${state.dot}`} />
            {state.label}
          </span>
        </div>
        <p className="text-lg leading-tight font-semibold tracking-[-0.2px]">{draft.title}</p>
        <p className="text-[13.5px] leading-normal text-ink-2">{draft.kind === "criar" ? draft.description : draft.note}</p>
      </div>
      <div className="px-[18px] pb-4">
        <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-rule pt-3">
          <Field label="Categoria">{draft.subcategory ? `${draft.category} › ${draft.subcategory}` : draft.category}</Field>
          <Field label="Prioridade">
            <PriorityValue priority={draft.priority} due={draft.dueAt ? (shortDate(draft.dueAt) === shortDate(new Date().toISOString()) ? time(draft.dueAt) : dateTime(draft.dueAt)) : null} />
          </Field>
          <Field label="Afetados">{AFFECTED_LABEL[draft.affected]}</Field>
        </div>
        {draft.kind === "criar" && <p className="mt-2.5 text-[12.5px] text-ink-3">Por que essa prioridade: {draft.priorityReason}</p>}
      </div>
      {draft.status === "pendente" && (
        <div className="flex items-center gap-1.5 border-t border-rule bg-desk py-2 pr-3.5 pl-2">
          <button
            type="button"
            disabled={!pending || busy}
            onClick={onConfirm}
            className="flex h-9 items-center gap-2 rounded-lg bg-cta pr-2.5 pl-3.5 text-[13.5px] font-semibold text-white hover:bg-cta-hover disabled:opacity-60"
          >
            {busy ? "Enviando…" : "Confirmar"}
            <kbd className="rounded-md bg-white/14 px-[5px] py-px font-ui text-[11.5px] text-white/80">Ctrl↵</kbd>
          </button>
          <button
            type="button"
            disabled={!pending || busy}
            onClick={onEdit}
            className="h-9 rounded-lg border border-line bg-paper px-3.5 text-[13.5px] font-medium hover:bg-desk disabled:opacity-60"
          >
            Editar
          </button>
          <button
            type="button"
            disabled={!pending || busy}
            onClick={onCancel}
            className="h-9 rounded-lg px-3.5 text-[13.5px] font-medium text-ink-2 hover:bg-paper disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

export function OptionsCard({
  question,
  options,
  disabled,
  onPick,
}: {
  question: string;
  options: string[];
  disabled?: boolean;
  onPick?: (option: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14.5px] font-semibold">{question}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o, i) => (
          <button
            key={o}
            type="button"
            disabled={disabled}
            onClick={() => onPick?.(o)}
            className="flex items-center gap-[7px] rounded-lg border border-rule bg-paper px-3 py-[7px] text-[13.5px] font-medium hover:border-primary hover:bg-primary-soft hover:text-primary-text disabled:pointer-events-none disabled:opacity-60"
          >
            <span className="grid size-4 place-items-center rounded-md bg-desk text-[12.5px] font-normal text-ink-3">{i + 1}</span>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export function HandoffCard({ queue, deadline, reason }: { queue: string; deadline: string; reason: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-[13.5px]">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-paper text-warning-text">
        <Headset size={16} />
      </span>
      <span className="flex flex-col">
        <span className="font-semibold">Transferido para o Suporte {queue}</span>
        <span className="text-ink-3">
          {reason} · um analista assume até {time(deadline)}
        </span>
      </span>
      <ArrowRightLeft size={16} className="ml-auto text-warning-text" />
    </div>
  );
}

export function cardKey(card: Card, i: number): string {
  switch (card.kind) {
    case "ticket":
      return `t-${card.ticket.id}-${i}`;
    case "draft":
      return `d-${card.draft.id}`;
    default:
      return `${card.kind}-${i}`;
  }
}
