import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  ticketSchema,
  type NewTicket,
  type Queue,
  type Ticket,
  type TicketStatus,
  type TicketUpdate,
} from "@nexo/shared";

// Persistência do "sistema legado". SQLite embutido no Node (node:sqlite):
// sobrevive a reinícios e não exige instalar nada além do próprio Node.

type Row = {
  id: string;
  type: string;
  title: string;
  description: string;
  category: string;
  subcategory: string | null;
  priority: string;
  status: string;
  affected: string;
  requester_id: string;
  queue: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  updates: string;
};

const toTicket = (r: Row): Ticket =>
  ticketSchema.parse({
    id: r.id,
    type: r.type,
    title: r.title,
    description: r.description,
    category: r.category,
    subcategory: r.subcategory,
    priority: r.priority,
    status: r.status,
    affected: r.affected,
    requesterId: r.requester_id,
    queue: r.queue,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
    updates: JSON.parse(r.updates),
  });

export class TicketRepo {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        subcategory TEXT,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        affected TEXT NOT NULL,
        requester_id TEXT NOT NULL,
        queue TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT,
        updates TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS tickets_requester ON tickets (requester_id);
      CREATE TABLE IF NOT EXISTS sequences (type TEXT PRIMARY KEY, next INTEGER NOT NULL);
    `);
  }

  isEmpty(): boolean {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM tickets").get() as { n: number };
    return row.n === 0;
  }

  listByRequester(requesterId: string): Ticket[] {
    const rows = this.db
      .prepare("SELECT * FROM tickets WHERE requester_id = ? ORDER BY updated_at DESC")
      .all(requesterId) as Row[];
    return rows.map(toTicket);
  }

  get(id: string): Ticket | null {
    const row = this.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as Row | undefined;
    return row ? toTicket(row) : null;
  }

  insert(t: Ticket): void {
    this.db
      .prepare(
        `INSERT INTO tickets (id, type, title, description, category, subcategory, priority, status, affected,
           requester_id, queue, created_at, updated_at, resolved_at, updates)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t.id,
        t.type,
        t.title,
        t.description,
        t.category,
        t.subcategory,
        t.priority,
        t.status,
        t.affected,
        t.requesterId,
        t.queue,
        t.createdAt,
        t.updatedAt,
        t.resolvedAt,
        JSON.stringify(t.updates),
      );
  }

  create(input: NewTicket, requesterId: string, now: Date): Ticket {
    const at = now.toISOString();
    const ticket: Ticket = {
      ...input,
      id: this.nextId(input.type),
      status: "aberto",
      requesterId,
      queue: null,
      createdAt: at,
      updatedAt: at,
      resolvedAt: null,
      updates: [{ at, author: "sistema", text: "Chamado aberto pelo Nexo Assist." }],
    };
    this.insert(ticket);
    return ticket;
  }

  addUpdate(
    id: string,
    update: TicketUpdate,
    changes: { status?: TicketStatus; queue?: Queue; resolvedAt?: string | null } = {},
  ): Ticket {
    const current = this.get(id);
    if (!current) throw new Error(`Chamado ${id} não existe`);
    const next: Ticket = {
      ...current,
      status: changes.status ?? current.status,
      queue: changes.queue ?? current.queue,
      resolvedAt: changes.resolvedAt !== undefined ? changes.resolvedAt : current.resolvedAt,
      updatedAt: update.at,
      updates: [...current.updates, update],
    };
    this.db
      .prepare("UPDATE tickets SET status = ?, queue = ?, resolved_at = ?, updated_at = ?, updates = ? WHERE id = ?")
      .run(next.status, next.queue, next.resolvedAt, next.updatedAt, JSON.stringify(next.updates), id);
    return next;
  }

  setSequence(type: "INC" | "REQ", next: number): void {
    this.db
      .prepare("INSERT INTO sequences (type, next) VALUES (?, ?) ON CONFLICT(type) DO UPDATE SET next = excluded.next")
      .run(type, next);
  }

  private nextId(type: "INC" | "REQ"): string {
    const row = this.db
      .prepare("UPDATE sequences SET next = next + 1 WHERE type = ? RETURNING next - 1 AS n")
      .get(type) as { n: number } | undefined;
    const n = row?.n ?? (type === "INC" ? 20500 : 10500);
    if (!row) this.setSequence(type, n + 1);
    return `${type}-${n}`;
  }

  close(): void {
    this.db.close();
  }
}
