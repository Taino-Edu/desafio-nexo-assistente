import "server-only";
import type { Employee } from "@nexo/shared";
import type { Card, DecisionStep, Intent, StreamEvent } from "@/lib/types";
import type { Conversation } from "../store";
import type { TicketsClient } from "../tickets-client";

/** O que o agent registrou em registrar_decisao neste turno. */
export type DeclaredDecision = {
  understanding: string;
  intent: Intent;
  plannedAction: string;
  confidence: number;
  reason: string;
  missingInfo: string[];
};

/**
 * Estado de um turno do agent. As ferramentas são criadas com este contexto
 * (closure): o funcionário vem da sessão autenticada, nunca de um argumento
 * que o modelo possa preencher.
 */
export type TurnContext = {
  employee: Employee;
  conversation: Conversation;
  turn: number;
  client: TicketsClient;
  now: () => Date;
  minConfidence: number;
  emit: (event: StreamEvent) => void;
  steps: DecisionStep[];
  cards: Card[];
  decision: DeclaredDecision | null;
  /** Quando o código decide interromper o modelo (ex.: confiança baixa). */
  gate: "baixa_confianca" | null;
  abort: AbortController;
  handedOff: boolean;
  ticketsUnavailable: boolean;
  /** Retries do cliente de chamados durante a ferramenta em execução. */
  retries: string[];
  /** Linhas de sistema gravadas depois da resposta (ex.: "Transferida para..."). */
  afterSystem: string[];
};
