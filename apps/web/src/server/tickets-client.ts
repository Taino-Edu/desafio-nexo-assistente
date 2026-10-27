import "server-only";
import { ticketViewSchema, type NewTicket, type Queue, type TicketView } from "@nexo/shared";
import { z } from "zod";
import { env } from "./env";

// Cliente HTTP do serviço de chamados. O legado cai por alguns segundos de vez
// em quando, então toda chamada tem timeout e novas tentativas com espera
// crescente. Se mesmo assim não responder, sobe um erro tipado e o agent avisa
// o funcionário em vez de inventar uma resposta.

export class TicketsUnavailableError extends Error {
  constructor(public attempts: number) {
    super("Sistema de chamados indisponível");
    this.name = "TicketsUnavailableError";
  }
}
export class TicketNotFoundError extends Error {
  constructor(public ticketId: string) {
    super(`Chamado ${ticketId} não encontrado`);
    this.name = "TicketNotFoundError";
  }
}
export class TicketConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketConflictError";
  }
}

export type Actor = { kind: "employee" | "analyst"; id: string };

export type TicketsClientOptions = {
  baseUrl?: string;
  token?: string;
  /** Espera antes de cada nova tentativa (ms). */
  backoff?: number[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Chamado a cada nova tentativa, para registrar na decisão. */
  onRetry?: (attempt: number, reason: string) => void;
};

const ticketsResponse = z.object({ tickets: z.array(ticketViewSchema) });
const ticketResponse = z.object({ ticket: ticketViewSchema });

export function ticketsClient(actor: Actor, opts: TicketsClientOptions = {}) {
  const baseUrl = opts.baseUrl ?? env().TICKETS_URL;
  const token = opts.token ?? env().TICKETS_SERVICE_TOKEN;
  const backoff = opts.backoff ?? [500, 1200, 2500];
  const timeoutMs = opts.timeoutMs ?? 4000;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  async function request<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown, ticketId?: string) {
    for (let attempt = 1; ; attempt++) {
      let reason: string;
      try {
        const res = await doFetch(`${baseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            "x-actor": `${actor.kind}:${actor.id}`,
            "content-type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) return schema.parse(await res.json());
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        if (res.status === 404) throw new TicketNotFoundError(ticketId ?? path);
        if (res.status === 409) throw new TicketConflictError(payload.message ?? "Operação não permitida");
        if (res.status < 500) throw new Error(`Serviço de chamados recusou (${res.status}): ${payload.message ?? ""}`);
        reason = `HTTP ${res.status}`;
      } catch (err) {
        if (err instanceof TicketNotFoundError || err instanceof TicketConflictError) throw err;
        if (err instanceof Error && err.message.startsWith("Serviço de chamados recusou")) throw err;
        if (err instanceof z.ZodError) throw err;
        reason = err instanceof Error ? err.name : "erro de rede";
      }
      const wait = backoff[attempt - 1];
      if (wait === undefined) throw new TicketsUnavailableError(attempt);
      opts.onRetry?.(attempt, reason);
      await sleep(wait);
    }
  }

  const enc = encodeURIComponent;

  return {
    list: async (requesterId?: string): Promise<TicketView[]> =>
      (await request("GET", `/tickets${requesterId ? `?requesterId=${enc(requesterId)}` : ""}`, ticketsResponse)).tickets,
    get: async (id: string): Promise<TicketView> =>
      (await request("GET", `/tickets/${enc(id)}`, ticketResponse, undefined, id)).ticket,
    create: async (input: NewTicket): Promise<TicketView> =>
      (await request("POST", "/tickets", ticketResponse, input)).ticket,
    addUpdate: async (id: string, text: string): Promise<TicketView> =>
      (await request("POST", `/tickets/${enc(id)}/updates`, ticketResponse, { text }, id)).ticket,
    reopen: async (id: string, text: string): Promise<TicketView> =>
      (await request("POST", `/tickets/${enc(id)}/reopen`, ticketResponse, { text }, id)).ticket,
    transfer: async (id: string, queue: Queue, summary: string): Promise<TicketView> =>
      (await request("POST", `/tickets/${enc(id)}/transfer`, ticketResponse, { queue, summary }, id)).ticket,
  };
}

export type TicketsClient = ReturnType<typeof ticketsClient>;
