import "server-only";
import {
  ANALYSTS,
  PRIORITY_LABEL,
  SLA,
  formatBrt,
  handoffDeadline,
  type Employee,
  type Queue,
  type TicketView,
} from "@nexo/shared";
import type { Card, Draft, TicketSummary } from "@/lib/types";
import { addMessage, getConversation, saveDraft, updateConversation, type Conversation } from "./store";
import type { TicketsClient } from "./tickets-client";

// Ações do service desk que não dependem do modelo. São usadas pelas
// ferramentas do agent e também direto pela interface (botão "Confirmar" do
// rascunho, console do analista). Assim a regra está num lugar só.

export function toSummary(t: TicketView): TicketSummary {
  return {
    id: t.id,
    type: t.type,
    title: t.title,
    description: t.description,
    category: t.category,
    subcategory: t.subcategory,
    priority: t.priority,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    dueAt: t.dueAt,
    overdue: t.overdue,
  };
}

export type ConfirmResult = { ticket: TicketView; text: string; card: Card };

/** Executa um rascunho confirmado pelo funcionário. */
export async function executeDraft(draft: Draft, client: TicketsClient): Promise<ConfirmResult> {
  let ticket: TicketView;
  let text: string;
  if (draft.kind === "criar") {
    ticket = await client.create({
      type: draft.type,
      title: draft.title,
      description: draft.description,
      category: draft.category,
      subcategory: draft.subcategory,
      priority: draft.priority,
      affected: draft.affected,
    });
    const due = ticket.dueAt ? ` (até ${formatDue(ticket.dueAt)})` : "";
    text = `Pronto: abri o chamado ${ticket.id} com prioridade ${PRIORITY_LABEL[ticket.priority].toLowerCase()}. Um analista fala com você em até ${SLA[ticket.priority].label}${due}.`;
  } else if (draft.kind === "reabrir") {
    ticket = await client.reopen(draft.ticketId!, draft.note ?? draft.description);
    text = `Pronto: reabri o ${ticket.id} com a nova informação. O prazo de resposta volta a contar agora.`;
  } else {
    ticket = await client.addUpdate(draft.ticketId!, draft.note ?? draft.description);
    text = `Pronto: adicionei a informação ao ${ticket.id}. O analista responsável vai ver no histórico do chamado.`;
  }
  saveDraft({ ...draft, status: "confirmado" });
  updateConversation(draft.conversationId, { relatedTicketId: ticket.id });
  return { ticket, text, card: { kind: "ticket", ticket: toSummary(ticket) } };
}

/** "13:43" se o prazo é hoje; "28 out, 10:54" se não é. */
export function formatDue(dueIso: string, now = new Date()): string {
  const sameDay = formatBrt(dueIso, { date: true }) === formatBrt(now.toISOString(), { date: true });
  return formatBrt(dueIso, sameDay ? { time: true } : { time: true, date: true });
}

export const HANDOFF_REASONS = {
  pedido_do_funcionario: "Funcionário pediu um analista",
  critico: "Caso crítico",
  chamado_vencido: "Chamado com prazo vencido",
  baixa_confianca: "Agent sem segurança para decidir",
  fora_do_alcance: "Agent não consegue resolver",
} as const;
export type HandoffReason = keyof typeof HANDOFF_REASONS;

/**
 * Transfere a conversa para um analista: marca como aguardando atendente
 * (o agent para de responder) e, se houver chamado, transfere no legado.
 */
export async function handoff(input: {
  conversation: Conversation;
  reason: HandoffReason;
  summary: string;
  ticket?: TicketView | null;
  client: TicketsClient;
  now?: Date;
}): Promise<{ card: Card; queue: Queue; deadline: string; text: string; systemText: string }> {
  const now = input.now ?? new Date();
  const ticket = input.ticket ?? null;
  const queue: Queue =
    input.reason === "critico" || input.reason === "chamado_vencido" || ticket?.overdue || ticket?.priority === "critica"
      ? "N2"
      : "N1";
  const deadline = handoffDeadline(ticket?.priority ?? null, now).toISOString();

  if (ticket) {
    await input.client.transfer(ticket.id, queue, input.summary);
  }
  updateConversation(input.conversation.id, {
    status: "waiting",
    transferReason: input.reason,
    transferSummary: input.summary,
    transferQueue: queue,
    transferDeadline: deadline,
    relatedTicketId: ticket?.id ?? input.conversation.relatedTicketId,
  });
  const window = ticket?.priority === "critica" ? "1 hora" : "2 horas úteis";
  return {
    queue,
    deadline,
    text: `Encaminhei para o Suporte ${queue}. Um analista vai falar com você em até ${window}. Enquanto isso, pode deixar aqui qualquer informação nova.`,
    card: { kind: "handoff", queue, deadline, reason: HANDOFF_REASONS[input.reason] },
    // Quem chama grava esta linha depois da resposta do agent, para a ordem
    // na conversa ficar natural ("Encaminhei..." e então "Transferida...").
    systemText: `Transferida para Suporte ${queue} · ${formatBrt(now.toISOString(), { time: true })}`,
  };
}

// --- console do analista -------------------------------------------------------

function analystName(id: string) {
  return ANALYSTS.find((a) => a.id === id)?.name ?? id;
}

export function takeOver(conversationId: string, analystId: string): void {
  updateConversation(conversationId, { status: "analyst", assignedAnalystId: analystId });
  addMessage({
    conversationId,
    role: "system",
    text: `${analystName(analystId)} assumiu · agent pausado · ${formatBrt(new Date().toISOString(), { time: true })}`,
  });
}

export function giveBack(conversationId: string, analystId: string): void {
  updateConversation(conversationId, {
    status: "agent",
    assignedAnalystId: null,
    transferReason: null,
    transferDeadline: null,
  });
  addMessage({
    conversationId,
    role: "system",
    text: `${analystName(analystId)} devolveu a conversa ao agent · ${formatBrt(new Date().toISOString(), { time: true })}`,
  });
}

export function closeConversation(conversationId: string, analystId: string): void {
  updateConversation(conversationId, { status: "closed" });
  addMessage({
    conversationId,
    role: "system",
    text: `Atendimento encerrado por ${analystName(analystId)} · ${formatBrt(new Date().toISOString(), { time: true })}`,
  });
}

export function employeeContext(e: Employee) {
  return `${e.name} (${e.department}), equipamento: ${e.device}`;
}

export { getConversation };
