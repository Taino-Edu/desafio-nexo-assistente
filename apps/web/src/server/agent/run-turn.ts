import "server-only";
import { randomUUID } from "node:crypto";
import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { Employee } from "@nexo/shared";
import type { Decision, DecisionOutcome, StreamEvent } from "@/lib/types";
import { env } from "../env";
import {
  addMessage,
  countEmployeeMessagesInSession,
  getConversation,
  getOrCreateActiveConversation,
  listMessages,
  nextTurn,
  pendingDraft,
  saveDecision,
} from "../store";
import { handoff } from "../service-desk";
import { ticketsClient, type TicketsClientOptions } from "../tickets-client";
import type { TurnContext } from "./context";
import { INSTRUCTIONS } from "./instructions";
import { toModelMessages, turnContext } from "./history";
import { buildTools } from "./tools";

// Um turno do agent: recebe a mensagem do funcionário, deixa o modelo decidir
// e agir pelas ferramentas, transmite o progresso em tempo real e grava a
// resposta junto com a decisão (o que entendeu, o que fez, confiança, porquê).

export const SESSION_MESSAGE_LIMIT = 30;
const MAX_STEPS = 6;

/** Opções de raciocínio por família: pouco raciocínio = resposta rápida e barata. */
function thinkingOptions(model: string) {
  if (model.startsWith("gemini-2.5")) return { thinkingConfig: { thinkingBudget: 0 } };
  return { thinkingConfig: { thinkingLevel: "low" as const } };
}

/** Dependências trocáveis nos testes (modelo roteirizado, legado em memória). */
export type TurnDeps = {
  model?: unknown;
  tickets?: TicketsClientOptions;
};

export async function runTurn(
  input: {
    employee: Employee;
    sessionId: string;
    text: string;
    emit: (event: StreamEvent) => void;
    now?: () => Date;
  },
  deps: TurnDeps = {},
): Promise<void> {
  const { employee, emit } = input;
  const now = input.now ?? (() => new Date());
  const config = env();

  if (countEmployeeMessagesInSession(input.sessionId) >= SESSION_MESSAGE_LIMIT) {
    emit({
      t: "error",
      message: `Você chegou ao limite de ${SESSION_MESSAGE_LIMIT} mensagens desta sessão. Saia e entre de novo para continuar, ou peça um analista.`,
    });
    return;
  }

  const conversation = getOrCreateActiveConversation(employee.id);
  const userMessage = addMessage({
    conversationId: conversation.id,
    role: "employee",
    text: input.text,
    sessionId: input.sessionId,
  });
  emit({ t: "user", message: userMessage });

  // Com um analista (ou aguardando um), o agent fica quieto.
  if (conversation.status !== "agent") {
    emit({ t: "paused", status: conversation.status });
    return;
  }

  const ctx: TurnContext = {
    employee,
    conversation,
    turn: nextTurn(conversation.id),
    client: null as unknown as TurnContext["client"],
    now,
    minConfidence: config.NEXO_MIN_CONFIDENCE,
    emit,
    steps: [],
    cards: [],
    decision: null,
    gate: null,
    abort: new AbortController(),
    handedOff: false,
    ticketsUnavailable: false,
    retries: [],
    afterSystem: [],
  };
  ctx.client = ticketsClient(
    { kind: "employee", id: employee.id },
    { ...deps.tickets, onRetry: (attempt, reason) => ctx.retries.push(`${attempt}ª falhou (${reason})`) },
  );

  const started = Date.now();
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let failure: string | null = null;

  if (!deps.model && !config.GOOGLE_GENERATIVE_AI_API_KEY) {
    failure = "GOOGLE_GENERATIVE_AI_API_KEY não configurada";
  } else {
    const agent = new Agent({
      id: "nexo-assist",
      name: "Nexo Assist",
      instructions: INSTRUCTIONS,
      // Roteador de modelos do Mastra: "provedor/modelo" com a chave explícita.
      model: (deps.model as MastraModelConfig | undefined) ?? {
        id: `google/${config.NEXO_MODEL}` as `${string}/${string}`,
        apiKey: config.GOOGLE_GENERATIVE_AI_API_KEY,
      },
      tools: buildTools(ctx),
    });

    try {
      const stream = await agent.stream(toModelMessages(listMessages(conversation.id)), {
        system: turnContext({
          employee,
          now: now(),
          pendingDraft: pendingDraft(conversation.id),
          relatedTicketId: conversation.relatedTicketId,
        }),
        maxSteps: MAX_STEPS,
        abortSignal: ctx.abort.signal,
        modelSettings: { temperature: 0.2, maxOutputTokens: 1024 },
        providerOptions: { google: thinkingOptions(config.NEXO_MODEL) },
        // Primeiro passo: obrigatoriamente registrar a decisão. É o que torna
        // cada resposta auditável, e o que permite barrar decisões inseguras.
        prepareStep: async ({ stepNumber }) =>
          stepNumber === 0 ? { toolChoice: { type: "tool" as const, toolName: "registrar_decisao" } } : undefined,
      });

      for await (const chunk of stream.fullStream) {
        if (chunk.type === "text-delta") {
          text += chunk.payload.text;
          emit({ t: "text", delta: chunk.payload.text });
        } else if (chunk.type === "step-finish") {
          const usage = (chunk.payload.output as { usage?: { inputTokens?: number; outputTokens?: number } }).usage;
          inputTokens += usage?.inputTokens ?? 0;
          outputTokens += usage?.outputTokens ?? 0;
        } else if (chunk.type === "error") {
          throw chunk.payload.error;
        }
      }
    } catch (err) {
      // Interrupção proposital (confiança baixa) não é falha.
      if (!ctx.gate) {
        console.error("[agent] falha no turno", err);
        failure = err instanceof Error ? err.message : String(err);
      }
    }
  }

  let outcome: DecisionOutcome = "respondeu";
  if (ctx.gate === "baixa_confianca") {
    outcome = "baixa_confianca";
    const pct = Math.round((ctx.decision?.confidence ?? 0) * 100);
    const result = await handoff({
      conversation,
      reason: "baixa_confianca",
      summary: `O agent não teve segurança para decidir (confiança ${pct}%). Entendeu: ${ctx.decision?.understanding ?? "—"}. Última mensagem: "${input.text}"`,
      client: ctx.client,
      now: now(),
    });
    ctx.cards.push(result.card);
    ctx.afterSystem.push(result.systemText);
    text = `Não tenho segurança para resolver isso sozinho, então prefiro chamar uma pessoa. ${result.text}`;
  } else if (failure) {
    outcome = "erro";
    text = "Tive um problema para responder agora. Pode tentar de novo em alguns instantes?";
  } else if (ctx.handedOff) {
    outcome = "transferiu";
  } else if (ctx.ticketsUnavailable) {
    outcome = "sistema_indisponivel";
  }

  if (!text.trim()) text = fallbackText(ctx);

  const decisionId = randomUUID();
  const agentMessage = addMessage({
    conversationId: conversation.id,
    role: "agent",
    authorName: "Nexo Assist",
    text: text.trim(),
    cards: ctx.cards,
    decisionId,
  });
  for (const line of ctx.afterSystem) addMessage({ conversationId: conversation.id, role: "system", text: line });

  const decision: Decision = {
    id: decisionId,
    conversationId: conversation.id,
    messageId: agentMessage.id,
    intent: ctx.decision?.intent ?? "nao_entendi",
    understanding: ctx.decision?.understanding ?? "O agent não registrou o que entendeu.",
    plannedAction: ctx.decision?.plannedAction ?? "—",
    confidence: ctx.decision?.confidence ?? 0,
    reason: failure ? `Falha ao gerar a resposta: ${failure}` : (ctx.decision?.reason ?? "—"),
    missingInfo: ctx.decision?.missingInfo ?? [],
    steps: ctx.steps,
    outcome,
    model: deps.model ? "roteiro-de-teste" : config.NEXO_MODEL,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - started,
    createdAt: new Date().toISOString(),
  };
  saveDecision(decision);

  emit({
    t: "done",
    message: agentMessage,
    decision,
    status: getConversation(conversation.id)?.status ?? conversation.status,
  });
}

/** Se o modelo agiu mas não escreveu nada, uma frase coerente com o que aconteceu. */
function fallbackText(ctx: TurnContext): string {
  if (ctx.ticketsUnavailable) return "O sistema de chamados não respondeu agora. Pode tentar de novo em alguns instantes?";
  const last = ctx.cards.at(-1);
  if (last?.kind === "draft") return "Confira o rascunho antes de eu continuar:";
  if (last?.kind === "ticket-list") return "Sobre qual deles você quer saber?";
  if (last?.kind === "options") return "";
  return "Pode me contar um pouco mais?";
}
