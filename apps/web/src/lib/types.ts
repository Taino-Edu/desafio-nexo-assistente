import type { Affected, Category, Priority, Queue, TicketStatus, TicketType } from "@nexo/shared";

// Tipos compartilhados entre o servidor e a interface. Nada de lógica aqui.

export type Role = "employee" | "analyst";

export type ConversationStatus = "agent" | "waiting" | "analyst" | "closed";

export type TicketSummary = {
  id: string;
  type: TicketType;
  title: string;
  description: string;
  category: Category;
  subcategory: string | null;
  priority: Priority;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  overdue: boolean;
};

export type DraftKind = "criar" | "atualizar" | "reabrir";
export type DraftStatus = "pendente" | "confirmado" | "cancelado" | "substituido";

export type Draft = {
  id: string;
  conversationId: string;
  kind: DraftKind;
  status: DraftStatus;
  /** Para atualizar/reabrir: o chamado alvo. */
  ticketId: string | null;
  type: TicketType;
  title: string;
  description: string;
  category: Category;
  subcategory: string | null;
  priority: Priority;
  priorityReason: string;
  affected: Affected;
  /** Para atualizar/reabrir: o texto que será adicionado. */
  note: string | null;
  /** Prazo de resposta se o chamado for criado agora. */
  dueAt: string | null;
  createdAt: string;
  /** Turno em que o rascunho foi mostrado; confirmar exige um turno posterior. */
  turn: number;
};

export type Card =
  | { kind: "ticket-list"; tickets: TicketSummary[]; selectable: boolean }
  | { kind: "ticket"; ticket: TicketSummary }
  | { kind: "draft"; draft: Draft }
  | { kind: "options"; question: string; options: string[] }
  | { kind: "handoff"; queue: Queue; deadline: string; reason: string };

export type MessageRole = "employee" | "agent" | "analyst" | "system";

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: MessageRole;
  authorName: string | null;
  text: string;
  cards: Card[];
  decisionId: string | null;
  createdAt: string;
};

export const INTENTS = [
  "duvida",
  "consultar_chamado",
  "complementar_chamado",
  "abrir_chamado",
  "confirmar_ou_editar_rascunho",
  "falar_com_analista",
  "fora_do_escopo",
  "conversa",
  "nao_entendi",
] as const;
export type Intent = (typeof INTENTS)[number];

export const INTENT_LABEL: Record<Intent, string> = {
  duvida: "Dúvida",
  consultar_chamado: "Consultar chamado",
  complementar_chamado: "Complementar chamado",
  abrir_chamado: "Abrir chamado",
  confirmar_ou_editar_rascunho: "Confirmar ou editar rascunho",
  falar_com_analista: "Falar com analista",
  fora_do_escopo: "Fora do escopo de TI",
  conversa: "Conversa",
  nao_entendi: "Não entendi",
};

/** Uma ferramenta executada pelo agent num turno. */
export type DecisionStep = {
  tool: string;
  labels: string[];
  input: unknown;
  ok: boolean;
  summary: string;
  durationMs: number;
};

export type DecisionOutcome =
  | "respondeu"
  | "transferiu"
  | "baixa_confianca"
  | "sistema_indisponivel"
  | "erro"
  | "confirmacao_direta";

/** O registro de transparência de cada resposta do agent. */
export type Decision = {
  id: string;
  conversationId: string;
  messageId: string | null;
  intent: Intent;
  understanding: string;
  plannedAction: string;
  confidence: number;
  reason: string;
  missingInfo: string[];
  steps: DecisionStep[];
  outcome: DecisionOutcome;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  createdAt: string;
};

export type ConversationSummary = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  status: ConversationStatus;
  assignedAnalystId: string | null;
  assignedAnalystName: string | null;
  transferReason: string | null;
  transferSummary: string | null;
  transferQueue: Queue | null;
  transferDeadline: string | null;
  relatedTicketId: string | null;
  lastConfidence: number | null;
  lastMessage: { role: MessageRole; text: string; at: string } | null;
  updatedAt: string;
};

/** Eventos do stream de uma resposta do agent (NDJSON). */
export type StreamEvent =
  | { t: "user"; message: ChatMessage }
  | { t: "step"; label: string }
  | { t: "text"; delta: string }
  | { t: "card"; card: Card }
  | { t: "done"; message: ChatMessage; decision: Decision; status: ConversationStatus }
  | { t: "paused"; status: ConversationStatus }
  | { t: "error"; message: string };
