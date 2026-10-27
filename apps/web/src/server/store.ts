import "server-only";
import { randomUUID } from "node:crypto";
import { EMPLOYEES, ANALYSTS, type Queue } from "@nexo/shared";
import { db } from "./db";
import type {
  Card,
  ChatMessage,
  ConversationStatus,
  ConversationSummary,
  Decision,
  Draft,
  MessageRole,
} from "@/lib/types";

// Repositório do Nexo Assist. SQL direto e pequeno: cada função faz uma coisa.

type ConversationRow = {
  id: string;
  employee_id: string;
  status: ConversationStatus;
  assigned_analyst_id: string | null;
  transfer_reason: string | null;
  transfer_summary: string | null;
  transfer_queue: Queue | null;
  transfer_deadline: string | null;
  related_ticket_id: string | null;
  last_confidence: number | null;
  turn: number;
  created_at: string;
  updated_at: string;
};

export type Conversation = {
  id: string;
  employeeId: string;
  status: ConversationStatus;
  assignedAnalystId: string | null;
  transferReason: string | null;
  transferSummary: string | null;
  transferQueue: Queue | null;
  transferDeadline: string | null;
  relatedTicketId: string | null;
  lastConfidence: number | null;
  turn: number;
  createdAt: string;
  updatedAt: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: MessageRole;
  author_name: string | null;
  text: string;
  cards: string;
  decision_id: string | null;
  created_at: string;
};

const nowIso = () => new Date().toISOString();

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  employeeId: r.employee_id,
  status: r.status,
  assignedAnalystId: r.assigned_analyst_id,
  transferReason: r.transfer_reason,
  transferSummary: r.transfer_summary,
  transferQueue: r.transfer_queue,
  transferDeadline: r.transfer_deadline,
  relatedTicketId: r.related_ticket_id,
  lastConfidence: r.last_confidence,
  turn: r.turn,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toMessage = (r: MessageRow): ChatMessage => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  authorName: r.author_name,
  text: r.text,
  cards: JSON.parse(r.cards) as Card[],
  decisionId: r.decision_id,
  createdAt: r.created_at,
});

// --- sessões -----------------------------------------------------------------

export function createSession(userId: string, role: "employee" | "analyst"): string {
  const id = randomUUID();
  db().prepare("INSERT INTO sessions (id, user_id, role, created_at) VALUES (?, ?, ?, ?)").run(id, userId, role, nowIso());
  return id;
}

export function getSession(id: string): { id: string; userId: string; role: "employee" | "analyst" } | null {
  const row = db().prepare("SELECT id, user_id, role FROM sessions WHERE id = ?").get(id) as
    | { id: string; user_id: string; role: "employee" | "analyst" }
    | undefined;
  return row ? { id: row.id, userId: row.user_id, role: row.role } : null;
}

export function deleteSession(id: string): void {
  db().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function countEmployeeMessagesInSession(sessionId: string): number {
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE session_id = ? AND role = 'employee'")
    .get(sessionId) as { n: number };
  return row.n;
}

// --- conversas ---------------------------------------------------------------

export function getConversation(id: string): Conversation | null {
  const row = db().prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | undefined;
  return row ? toConversation(row) : null;
}

/** A conversa em aberto do funcionário; cria uma nova se a última foi encerrada. */
export function getOrCreateActiveConversation(employeeId: string): Conversation {
  const row = db()
    .prepare("SELECT * FROM conversations WHERE employee_id = ? AND status != 'closed' ORDER BY updated_at DESC LIMIT 1")
    .get(employeeId) as ConversationRow | undefined;
  if (row) return toConversation(row);
  const id = randomUUID();
  const at = nowIso();
  db()
    .prepare("INSERT INTO conversations (id, employee_id, status, created_at, updated_at) VALUES (?, ?, 'agent', ?, ?)")
    .run(id, employeeId, at, at);
  return getConversation(id)!;
}

export function updateConversation(
  id: string,
  changes: Partial<
    Pick<
      Conversation,
      | "status"
      | "assignedAnalystId"
      | "transferReason"
      | "transferSummary"
      | "transferQueue"
      | "transferDeadline"
      | "relatedTicketId"
      | "lastConfidence"
    >
  >,
): void {
  const columns: Record<string, string> = {
    status: "status",
    assignedAnalystId: "assigned_analyst_id",
    transferReason: "transfer_reason",
    transferSummary: "transfer_summary",
    transferQueue: "transfer_queue",
    transferDeadline: "transfer_deadline",
    relatedTicketId: "related_ticket_id",
    lastConfidence: "last_confidence",
  };
  const entries = Object.entries(changes).filter(([k]) => k in columns);
  const sets = entries.map(([k]) => `${columns[k]} = ?`);
  const values = entries.map(([, v]) => (v === undefined ? null : v)) as (string | number | null)[];
  db()
    .prepare(`UPDATE conversations SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?`)
    .run(...values, nowIso(), id);
}

/** Incrementa e devolve o número do turno do agent nesta conversa. */
export function nextTurn(conversationId: string): number {
  const row = db()
    .prepare("UPDATE conversations SET turn = turn + 1 WHERE id = ? RETURNING turn")
    .get(conversationId) as { turn: number };
  return row.turn;
}

export function listConversations(): ConversationSummary[] {
  const rows = db().prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 200").all() as ConversationRow[];
  const last = db().prepare(
    "SELECT role, text, created_at FROM messages WHERE conversation_id = ? AND role != 'system' ORDER BY created_at DESC LIMIT 1",
  );
  return rows.map((r) => {
    const c = toConversation(r);
    const employee = EMPLOYEES.find((e) => e.id === c.employeeId);
    const analyst = ANALYSTS.find((a) => a.id === c.assignedAnalystId);
    const m = last.get(c.id) as { role: MessageRole; text: string; created_at: string } | undefined;
    return {
      id: c.id,
      employeeId: c.employeeId,
      employeeName: employee?.name ?? c.employeeId,
      department: employee?.department ?? "",
      status: c.status,
      assignedAnalystId: c.assignedAnalystId,
      assignedAnalystName: analyst?.name ?? null,
      transferReason: c.transferReason,
      transferSummary: c.transferSummary,
      transferQueue: c.transferQueue,
      transferDeadline: c.transferDeadline,
      relatedTicketId: c.relatedTicketId,
      lastConfidence: c.lastConfidence,
      lastMessage: m ? { role: m.role, text: m.text, at: m.created_at } : null,
      updatedAt: c.updatedAt,
    };
  });
}

// --- mensagens ---------------------------------------------------------------

export function addMessage(input: {
  conversationId: string;
  role: MessageRole;
  text: string;
  authorName?: string | null;
  cards?: Card[];
  sessionId?: string | null;
  decisionId?: string | null;
}): ChatMessage {
  const id = randomUUID();
  const at = nowIso();
  db()
    .prepare(
      `INSERT INTO messages (id, conversation_id, session_id, role, author_name, text, cards, decision_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.conversationId,
      input.sessionId ?? null,
      input.role,
      input.authorName ?? null,
      input.text,
      JSON.stringify(input.cards ?? []),
      input.decisionId ?? null,
      at,
    );
  db().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(at, input.conversationId);
  return toMessage(db().prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow);
}

export function listMessages(conversationId: string, limit = 300): ChatMessage[] {
  const rows = db()
    .prepare("SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?) ORDER BY created_at, rowid")
    .all(conversationId, limit) as MessageRow[];
  return rows.map(toMessage);
}

// --- decisões ----------------------------------------------------------------

export function saveDecision(d: Decision): void {
  db()
    .prepare("INSERT INTO decisions (id, conversation_id, message_id, data, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(d.id, d.conversationId, d.messageId, JSON.stringify(d), d.createdAt);
}

export function listDecisions(conversationId: string): Decision[] {
  const rows = db()
    .prepare("SELECT data FROM decisions WHERE conversation_id = ? ORDER BY created_at")
    .all(conversationId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Decision);
}

// --- rascunhos ---------------------------------------------------------------

export function nextDraftId(): string {
  const row = db()
    .prepare("UPDATE counters SET value = value + 1 WHERE name = 'draft' RETURNING value")
    .get() as { value: number };
  return `D-${row.value}`;
}

export function saveDraft(d: Draft): void {
  db()
    .prepare(
      `INSERT INTO drafts (id, conversation_id, status, data, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data`,
    )
    .run(d.id, d.conversationId, d.status, JSON.stringify(d), d.createdAt);
}

export function getDraft(id: string): Draft | null {
  const row = db().prepare("SELECT data FROM drafts WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Draft) : null;
}

export function pendingDraft(conversationId: string): Draft | null {
  const row = db()
    .prepare("SELECT data FROM drafts WHERE conversation_id = ? AND status = 'pendente' ORDER BY created_at DESC LIMIT 1")
    .get(conversationId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Draft) : null;
}

/** Um rascunho novo substitui o anterior ainda pendente. */
export function supersedePendingDrafts(conversationId: string): void {
  for (const row of db()
    .prepare("SELECT data FROM drafts WHERE conversation_id = ? AND status = 'pendente'")
    .all(conversationId) as { data: string }[]) {
    const d = JSON.parse(row.data) as Draft;
    saveDraft({ ...d, status: "substituido" });
  }
}
