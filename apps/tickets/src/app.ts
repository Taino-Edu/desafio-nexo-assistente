import { Hono, type Context } from "hono";
import { z } from "zod";
import { newTicketSchema, QUEUES, ticketSlaState, type Ticket, type TicketView } from "@nexo/shared";
import type { TicketRepo } from "./repo";
import type { Chaos } from "./chaos";

// API do serviço de chamados. Quem chama é sempre o servidor do Nexo Assist
// (token de serviço), agindo em nome de alguém: o cabeçalho x-actor diz quem.
// A regra de privacidade fica aqui também, e não só no agent: um funcionário
// só enxerga os próprios chamados, e um chamado de outra pessoa responde 404
// (e não 403), para não confirmar que o número existe.

type Actor = { kind: "employee" | "analyst"; id: string };
type Env = { Variables: { actor: Actor } };

export type AppDeps = {
  repo: TicketRepo;
  chaos: Chaos;
  serviceToken: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const updateBody = z.object({ text: z.string().min(1).max(2000) });
const transferBody = z.object({ queue: z.enum(QUEUES), summary: z.string().min(1).max(2000) });
const outageBody = z.object({ ms: z.number().int().min(100).max(60_000) });

export function createApp(deps: AppDeps) {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const app = new Hono<Env>();

  const view = (t: Ticket): TicketView => ({ ...t, ...ticketSlaState(t, now()) });
  const notFound = (c: Context) => c.json({ error: "not_found", message: "Chamado não encontrado." }, 404);

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("*", async (c, next) => {
    if (c.req.header("authorization") !== `Bearer ${deps.serviceToken}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const match = /^(employee|analyst):([\w-]+)$/.exec(c.req.header("x-actor") ?? "");
    if (!match) return c.json({ error: "missing_actor", message: "Informe x-actor." }, 400);
    c.set("actor", { kind: match[1] as Actor["kind"], id: match[2]! });

    await sleep(deps.chaos.latency());
    if (deps.chaos.shouldFail()) {
      return c.json({ error: "unavailable", message: "Sistema de chamados indisponível." }, 503);
    }
    await next();
  });

  /** Carrega o chamado respeitando a regra de privacidade. */
  const load = (c: Context<Env>): Ticket | null => {
    const ticket = deps.repo.get(c.req.param("id") ?? "");
    const actor = c.get("actor");
    if (!ticket) return null;
    if (actor.kind === "employee" && ticket.requesterId !== actor.id) return null;
    return ticket;
  };

  app.get("/tickets", (c) => {
    const actor = c.get("actor");
    const requesterId = actor.kind === "employee" ? actor.id : c.req.query("requesterId");
    if (!requesterId) return c.json({ error: "bad_request", message: "Informe requesterId." }, 400);
    return c.json({ tickets: deps.repo.listByRequester(requesterId).map(view) });
  });

  app.get("/tickets/:id", (c) => {
    const ticket = load(c);
    return ticket ? c.json({ ticket: view(ticket) }) : notFound(c);
  });

  app.post("/tickets", async (c) => {
    const actor = c.get("actor");
    if (actor.kind !== "employee") return c.json({ error: "forbidden" }, 403);
    const parsed = newTicketSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad_request", issues: parsed.error.issues }, 400);
    return c.json({ ticket: view(deps.repo.create(parsed.data, actor.id, now())) }, 201);
  });

  app.post("/tickets/:id/updates", async (c) => {
    const ticket = load(c);
    if (!ticket) return notFound(c);
    const parsed = updateBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad_request", issues: parsed.error.issues }, 400);
    if (ticket.status === "fechado" || ticket.status === "resolvido") {
      return c.json({ error: "conflict", message: "Chamado encerrado; reabra antes de atualizar." }, 409);
    }
    const author = c.get("actor").kind === "employee" ? "funcionario" : "analista";
    const updated = deps.repo.addUpdate(ticket.id, { at: now().toISOString(), author, text: parsed.data.text });
    return c.json({ ticket: view(updated) });
  });

  app.post("/tickets/:id/reopen", async (c) => {
    const ticket = load(c);
    if (!ticket) return notFound(c);
    const parsed = updateBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad_request", issues: parsed.error.issues }, 400);
    const resolvedAt = ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : null;
    if (ticket.status !== "resolvido" || resolvedAt === null || now().getTime() - resolvedAt > REOPEN_WINDOW_MS) {
      return c.json({ error: "conflict", message: "Só chamados resolvidos há até 7 dias podem ser reabertos." }, 409);
    }
    const updated = deps.repo.addUpdate(
      ticket.id,
      { at: now().toISOString(), author: "funcionario", text: `Reaberto: ${parsed.data.text}` },
      { status: "aberto", resolvedAt: null },
    );
    return c.json({ ticket: view(updated) });
  });

  app.post("/tickets/:id/transfer", async (c) => {
    const ticket = load(c);
    if (!ticket) return notFound(c);
    const parsed = transferBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad_request", issues: parsed.error.issues }, 400);
    const updated = deps.repo.addUpdate(
      ticket.id,
      { at: now().toISOString(), author: "sistema", text: `Transferido para Suporte ${parsed.data.queue}. ${parsed.data.summary}` },
      { status: "aguardando_analista", queue: parsed.data.queue },
    );
    return c.json({ ticket: view(updated) });
  });

  // Para demonstrar a resiliência: derruba o "legado" por alguns segundos.
  app.post("/admin/outage", async (c) => {
    if (c.get("actor").kind !== "analyst") return c.json({ error: "forbidden" }, 403);
    const parsed = outageBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad_request" }, 400);
    deps.chaos.forceOutage(parsed.data.ms);
    return c.json({ ok: true });
  });

  app.onError((err, c) => {
    console.error("[tickets]", err);
    return c.json({ error: "internal", message: "Erro interno no serviço de chamados." }, 500);
  });

  return app;
}
