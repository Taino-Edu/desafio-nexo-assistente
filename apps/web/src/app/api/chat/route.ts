import { z } from "zod";
import type { StreamEvent } from "@/lib/types";
import { requireEmployee } from "@/server/auth";
import { runTurn, SESSION_MESSAGE_LIMIT } from "@/server/agent/run-turn";
import {
  countEmployeeMessagesInSession,
  getOrCreateActiveConversation,
  listDecisions,
  listMessages,
  withLiveDrafts,
} from "@/server/store";
import { rateLimit } from "@/server/rate-limit";
import { env } from "@/server/env";

// GET: estado da conversa do funcionário logado (usado no carregamento e no
// polling enquanto um analista atende). POST: envia uma mensagem e devolve a
// resposta do agent em streaming, um evento JSON por linha.

export async function GET() {
  const user = await requireEmployee();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const conversation = getOrCreateActiveConversation(user.employee.id);
  return Response.json({
    conversation: { id: conversation.id, status: conversation.status, transferDeadline: conversation.transferDeadline },
    messages: withLiveDrafts(listMessages(conversation.id)),
    decisions: listDecisions(conversation.id),
    session: { used: countEmployeeMessagesInSession(user.sessionId), limit: SESSION_MESSAGE_LIMIT },
  });
}

const body = z.object({ text: z.string().trim().min(1).max(2000) });

export async function POST(req: Request) {
  const user = await requireEmployee();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!rateLimit(`chat:${user.employee.id}`, 12, 60_000)) {
    return Response.json({ error: "rate_limited", message: "Muitas mensagens em pouco tempo. Espere um pouco." }, { status: 429 });
  }
  if (!rateLimit("chat:global", env().NEXO_DAILY_TURN_LIMIT, 24 * 60 * 60 * 1000)) {
    return Response.json(
      { error: "daily_limit", message: "O limite diário de uso da demonstração foi atingido. Tente amanhã." },
      { status: 429 },
    );
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: StreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await runTurn({ employee: user.employee, sessionId: user.sessionId, text: parsed.data.text, emit });
      } catch (err) {
        console.error("[chat] turno falhou", err);
        emit({ t: "error", message: "Não consegui processar a mensagem. Tente de novo." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
