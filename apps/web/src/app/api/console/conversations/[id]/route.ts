import { z } from "zod";
import { EMPLOYEES } from "@nexo/shared";
import { requireAnalyst } from "@/server/auth";
import { addMessage, getConversation, listConversations, listDecisions, listMessages, withLiveDrafts } from "@/server/store";
import { closeConversation, giveBack, takeOver, toSummary } from "@/server/service-desk";
import { ticketsClient, TicketsUnavailableError } from "@/server/tickets-client";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const user = await requireAnalyst();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const conversation = getConversation((await params).id);
  if (!conversation) return Response.json({ error: "not_found" }, { status: 404 });

  // Os chamados vêm do serviço de chamados com o analista como ator. Se o
  // legado estiver fora, a conversa ainda aparece; só o painel fica indisponível.
  let tickets = null;
  try {
    tickets = (await ticketsClient({ kind: "analyst", id: user.analyst.id }, { backoff: [300] }).list(conversation.employeeId)).map(toSummary);
  } catch (err) {
    if (!(err instanceof TicketsUnavailableError)) throw err;
  }

  return Response.json({
    conversation: listConversations().find((c) => c.id === conversation.id),
    employee: EMPLOYEES.find((e) => e.id === conversation.employeeId) ?? null,
    messages: withLiveDrafts(listMessages(conversation.id)),
    decisions: listDecisions(conversation.id),
    tickets,
  });
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assumir") }),
  z.object({ action: z.literal("devolver") }),
  z.object({ action: z.literal("encerrar") }),
  z.object({ action: z.literal("mensagem"), text: z.string().trim().min(1).max(2000) }),
]);

export async function POST(req: Request, { params }: Params) {
  const user = await requireAnalyst();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const conversation = getConversation((await params).id);
  if (!conversation) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });

  const mine = conversation.status === "analyst" && conversation.assignedAnalystId === user.analyst.id;
  const conflict = (message: string) => Response.json({ error: message }, { status: 409 });

  switch (parsed.data.action) {
    case "assumir":
      if (conversation.status === "closed") return conflict("Conversa encerrada.");
      if (conversation.status === "analyst" && !mine) return conflict("Outro analista já assumiu esta conversa.");
      if (!mine) takeOver(conversation.id, user.analyst.id);
      break;
    case "devolver":
      if (conversation.status === "closed") return conflict("Conversa encerrada.");
      if (conversation.status === "analyst" && !mine) return conflict("A conversa está com outro analista.");
      giveBack(conversation.id, user.analyst.id);
      break;
    case "encerrar":
      if (conversation.status === "closed") return conflict("Conversa já encerrada.");
      closeConversation(conversation.id, user.analyst.id);
      break;
    case "mensagem":
      if (!mine) return conflict("Assuma o atendimento para responder.");
      addMessage({
        conversationId: conversation.id,
        role: "analyst",
        authorName: user.analyst.name,
        text: parsed.data.text,
      });
      break;
  }
  return Response.json({ ok: true });
}
