import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "./env";

// Banco do Nexo Assist (conversas, mensagens, decisões, rascunhos e sessões).
// É separado do banco do serviço de chamados de propósito: o agent não tem
// acesso direto aos chamados, só pela API.

const MIGRATIONS = [
  `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    status TEXT NOT NULL,
    assigned_analyst_id TEXT,
    transfer_reason TEXT,
    transfer_summary TEXT,
    transfer_queue TEXT,
    transfer_deadline TEXT,
    related_ticket_id TEXT,
    last_confidence REAL,
    turn INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX conversations_employee ON conversations (employee_id, updated_at);

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    session_id TEXT,
    role TEXT NOT NULL,
    author_name TEXT,
    text TEXT NOT NULL,
    cards TEXT NOT NULL DEFAULT '[]',
    decision_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX messages_conversation ON messages (conversation_id, created_at);
  CREATE INDEX messages_session ON messages (session_id, role);

  CREATE TABLE decisions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    message_id TEXT,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX decisions_conversation ON decisions (conversation_id, created_at);

  CREATE TABLE drafts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    status TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX drafts_conversation ON drafts (conversation_id, status);

  CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
  INSERT INTO counters (name, value) VALUES ('draft', 380);
  `,
];

function open(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  while (version < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]!);
      version++;
      db.prepare("UPDATE schema_version SET version = ?").run(version);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return db;
}

// Em desenvolvimento o Next recarrega módulos; guardar no globalThis evita
// abrir uma conexão nova a cada recarga.
const g = globalThis as unknown as { __nexoDb?: DatabaseSync };

export function db(): DatabaseSync {
  g.__nexoDb ??= open(resolve(/* turbopackIgnore: true */ process.cwd(), env().WEB_DB_PATH));
  return g.__nexoDb;
}

/** Para testes: banco em memória isolado. */
export function useTestDb(): DatabaseSync {
  g.__nexoDb = open(":memory:");
  return g.__nexoDb;
}

export function transaction<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}
