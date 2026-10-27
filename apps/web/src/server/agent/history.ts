import "server-only";
import { PRIORITY_LABEL, STATUS_LABEL, formatBrt, type Employee } from "@nexo/shared";
import type { Card, ChatMessage, Draft } from "@/lib/types";
import { getDraft } from "../store";

// Monta o que o modelo vê a cada turno. Para controlar custo, vão só as
// últimas mensagens, e os cartões viram uma linha de texto em vez do JSON
// completo. O estado que importa (rascunho pendente, chamado em foco) vai no
// contexto do sistema, sempre atualizado a partir do banco.

export const HISTORY_WINDOW = 20;

export type ModelMessage = { role: "user"; content: string } | { role: "assistant"; content: string };

function describeCard(card: Card): string {
  switch (card.kind) {
    case "ticket-list":
      return `[mostrou a lista de chamados: ${card.tickets.map((t) => `${t.id} (${STATUS_LABEL[t.status]})`).join(", ")}]`;
    case "ticket":
      return `[mostrou o chamado ${card.ticket.id}: ${STATUS_LABEL[card.ticket.status]}, prioridade ${PRIORITY_LABEL[card.ticket.priority]}${card.ticket.overdue ? ", prazo vencido" : ""}]`;
    case "draft": {
      // O status atual vem do banco: o rascunho pode ter sido confirmado pelo botão.
      const current = getDraft(card.draft.id)?.status ?? card.draft.status;
      return `[mostrou o rascunho ${card.draft.id} (${card.draft.kind}${card.draft.ticketId ? ` ${card.draft.ticketId}` : ""}): "${card.draft.title}", ${card.draft.category}, prioridade ${PRIORITY_LABEL[card.draft.priority]} — status atual: ${current}]`;
    }
    case "options":
      return `[ofereceu opções: "${card.question}" → ${card.options.join(" | ")}]`;
    case "handoff":
      return `[transferiu para o Suporte ${card.queue}]`;
  }
}

export function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.slice(-HISTORY_WINDOW).map((m): ModelMessage => {
    const cards = m.cards.map(describeCard).join(" ");
    switch (m.role) {
      case "employee":
        return { role: "user", content: m.text };
      case "agent":
        return { role: "assistant", content: [m.text, cards].filter(Boolean).join(" ") };
      case "analyst":
        return { role: "assistant", content: `(Analista ${m.authorName ?? ""}): ${m.text}` };
      case "system":
        return { role: "assistant", content: `[sistema: ${m.text}]` };
    }
  });
}

export function turnContext(input: {
  employee: Employee;
  now: Date;
  pendingDraft: Draft | null;
  relatedTicketId: string | null;
}): string {
  const hour = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }).format(input.now));
  const weekday = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long" }).format(input.now);
  const open = !/s[áa]bado|domingo/.test(weekday) && hour >= 8 && hour < 18;
  const d = input.pendingDraft;
  return [
    `Funcionário: ${input.employee.name}, área ${input.employee.department}. Equipamento: ${input.employee.device}.`,
    `Agora: ${weekday}, ${formatBrt(input.now.toISOString())} (Brasília). Service desk ${open ? "aberto" : "fechado (só críticos têm plantão)"}.`,
    d
      ? `Rascunho pendente de confirmação: ${d.id} (${d.kind}${d.ticketId ? ` ${d.ticketId}` : ""}) "${d.title}".`
      : "Nenhum rascunho pendente.",
    input.relatedTicketId ? `Chamado em foco nesta conversa: ${input.relatedTicketId}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
