import "server-only";
import { randomUUID } from "node:crypto";
import type { Employee } from "@nexo/shared";
import type { ChatMessage, Decision, DecisionStep } from "@/lib/types";
import { addMessage, getConversation, getDraft, saveDecision, saveDraft } from "./store";
import { executeDraft, handoff } from "./service-desk";
import { ticketsClient, TicketsUnavailableError } from "./tickets-client";

// Confirmar ou cancelar um rascunho pelo botão do cartão. É uma ação
// determinística: não passa pelo modelo (mais rápido e sem custo), mas gera
// uma decisão como qualquer outra resposta, para manter a trilha completa.

export class DraftActionError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function actOnDraft(employee: Employee, draftId: string, action: "confirmar" | "cancelar"): Promise<ChatMessage[]> {
  const draft = getDraft(draftId);
  const conversation = draft ? getConversation(draft.conversationId) : null;
  if (!draft || !conversation || conversation.employeeId !== employee.id) {
    throw new DraftActionError("Rascunho não encontrado.", 404);
  }
  if (draft.status !== "pendente") throw new DraftActionError(`Este rascunho já foi ${draft.status}.`, 409);
  if (conversation.status !== "agent") throw new DraftActionError("A conversa está com um analista.", 409);

  const started = Date.now();
  const steps: DecisionStep[] = [];
  const created: ChatMessage[] = [];
  const decisionId = randomUUID();

  if (action === "cancelar") {
    saveDraft({ ...draft, status: "cancelado" });
    steps.push({ tool: "cancelar_rascunho", labels: ["descartou o rascunho"], input: { draftId }, ok: true, summary: `${draft.id} cancelado`, durationMs: 0 });
    created.push(
      addMessage({
        conversationId: conversation.id,
        role: "agent",
        authorName: "Nexo Assist",
        text: "Tudo bem, descartei o rascunho. Se quiser, me conte de novo o que precisa.",
        decisionId,
      }),
    );
  } else {
    const retries: string[] = [];
    const client = ticketsClient(
      { kind: "employee", id: employee.id },
      { onRetry: (n, reason) => retries.push(`${n}ª falhou (${reason})`) },
    );
    let result;
    try {
      result = await executeDraft(draft, client);
    } catch (err) {
      if (err instanceof TicketsUnavailableError) {
        throw new DraftActionError("O sistema de chamados não respondeu. O rascunho continua salvo: tente confirmar de novo em instantes.", 503);
      }
      throw err;
    }
    steps.push({
      tool: "confirmar_rascunho",
      labels: [draft.kind === "criar" ? `criou o chamado ${result.ticket.id}` : `${draft.kind === "reabrir" ? "reabriu" : "atualizou"} o ${result.ticket.id}`],
      input: { draftId },
      ok: true,
      summary: `${draft.id} → ${result.ticket.id}${retries.length ? ` (novas tentativas: ${retries.join(", ")})` : ""}`,
      durationMs: Date.now() - started,
    });

    let text = result.text;
    const cards = [result.card];
    let systemText: string | null = null;
    // Anexo A: caso crítico vai direto para um analista.
    if (result.ticket.priority === "critica") {
      const h = await handoff({
        conversation,
        reason: "critico",
        summary: `Chamado crítico ${result.ticket.id}: ${result.ticket.title}. ${result.ticket.description}`,
        ticket: result.ticket,
        client,
      });
      steps.push({ tool: "transferir_para_analista", labels: ["transferiu para um analista"], input: { motivo: "critico" }, ok: true, summary: `Suporte ${h.queue}`, durationMs: 0 });
      text = `${text} Como é crítico, já chamei o Suporte ${h.queue}.`;
      cards.push(h.card);
      systemText = h.systemText;
    }
    created.push(addMessage({ conversationId: conversation.id, role: "agent", authorName: "Nexo Assist", text, cards, decisionId }));
    if (systemText) created.push(addMessage({ conversationId: conversation.id, role: "system", text: systemText }));
  }

  const decision: Decision = {
    id: decisionId,
    conversationId: conversation.id,
    messageId: created[0]!.id,
    intent: "confirmar_ou_editar_rascunho",
    understanding: action === "confirmar" ? `Funcionário confirmou o rascunho ${draft.id}.` : `Funcionário descartou o rascunho ${draft.id}.`,
    plannedAction: action === "confirmar" ? "Executar o rascunho no sistema de chamados" : "Descartar o rascunho",
    confidence: 1,
    reason: "Ação feita pelo botão do cartão: a confirmação é explícita, então não foi preciso consultar o modelo.",
    missingInfo: [],
    steps,
    outcome: "confirmacao_direta",
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: Date.now() - started,
    createdAt: new Date().toISOString(),
  };
  saveDecision(decision);
  return created;
}
