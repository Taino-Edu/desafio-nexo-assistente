import { beforeEach, describe, expect, it } from "vitest";
import { EMPLOYEES } from "@nexo/shared";
import type { Card, StreamEvent } from "@/lib/types";
import { useTestDb } from "../db";
import { createSession, getConversation, getOrCreateActiveConversation, listDecisions, listMessages, updateConversation, pendingDraft } from "../store";
import { runTurn, SESSION_MESSAGE_LIMIT, type TurnDeps } from "./run-turn";
import { scriptedModel, type ScriptStep } from "./testing/scripted-model";
// O legado real, em memória: o teste passa pelo HTTP e pelas regras dele.
import { createApp } from "../../../../tickets/src/app";
import { Chaos } from "../../../../tickets/src/chaos";
import { TicketRepo } from "../../../../tickets/src/repo";
import { seed } from "../../../../tickets/src/seed";

const ana = EMPLOYEES.find((e) => e.id === "u-ana")!;
const diego = EMPLOYEES.find((e) => e.id === "u-diego")!;

let tickets: TicketRepo;
let outage = false;

function legacy(): TurnDeps["tickets"] {
  const app = createApp({
    repo: tickets,
    chaos: new Chaos({ outageChance: outage ? 1 : 0, outageMs: 60_000, latencyMs: [0, 0] }),
    serviceToken: "token-de-teste",
    sleep: async () => {},
  });
  return {
    fetchImpl: ((input: string, init?: RequestInit) => app.request(input, init)) as typeof fetch,
    sleep: async () => {},
  };
}

async function turn(employee: typeof ana, text: string, steps: ScriptStep[], sessionId = "s1") {
  const events: StreamEvent[] = [];
  const scripted = scriptedModel(steps);
  await runTurn({ employee, sessionId, text, emit: (e) => events.push(e) }, { model: scripted.model, tickets: legacy() });
  const done = events.find((e) => e.t === "done");
  const cards = events.flatMap((e) => (e.t === "card" ? [e.card] : []));
  const labels = events.flatMap((e) => (e.t === "step" ? [e.label] : []));
  return { events, done: done?.t === "done" ? done : null, cards, labels, calls: scripted.calls };
}

const decide = (intencao: string, confianca = 0.9) => ({
  name: "registrar_decisao",
  input: { entendimento: "teste", intencao, acao: "agir", confianca, motivo: "porque sim", faltando: [] },
});

beforeEach(() => {
  useTestDb();
  createSession("u-ana", "employee");
  tickets = new TicketRepo(":memory:");
  seed(tickets);
  outage = false;
});

describe("turno do agent", () => {
  it("força registrar a decisão no primeiro passo e grava tudo", async () => {
    const r = await turn(ana, "Qual o status do meu chamado?", [
      { tools: [decide("consultar_chamado")] },
      { tools: [{ name: "listar_meus_chamados", input: { escopo: "abertos" } }] },
      { text: "Você tem 3 chamados abertos. Sobre qual deles quer saber?" },
    ]);

    expect(r.calls[0]?.toolChoice).toMatchObject({ type: "tool", toolName: "registrar_decisao" });
    expect(r.labels).toContain("consultou seus chamados");
    const list = r.cards.find((c): c is Extract<Card, { kind: "ticket-list" }> => c.kind === "ticket-list");
    expect(list?.selectable).toBe(true);
    expect(list?.tickets.map((t) => t.id).sort()).toEqual(["INC-20298", "INC-20311", "REQ-10442"]);

    expect(r.done?.decision).toMatchObject({ intent: "consultar_chamado", confidence: 0.9, outcome: "respondeu" });
    expect(r.done?.decision.steps.map((s) => s.tool)).toEqual(["listar_meus_chamados"]);
    expect(r.done?.message.text).toBe("Você tem 3 chamados abertos. Sobre qual deles quer saber?");
    expect(listDecisions(getOrCreateActiveConversation("u-ana").id)).toHaveLength(1);
  });

  it("não mostra chamado de outra pessoa, mesmo se o modelo pedir", async () => {
    const r = await turn(ana, "Me mostra o INC-20488", [
      { tools: [decide("consultar_chamado")] },
      { tools: [{ name: "consultar_chamado", input: { id: "INC-20488" } }] },
      { text: "Não encontrei esse chamado entre os seus." },
    ]);
    expect(r.cards).toHaveLength(0);
    const step = r.done?.decision.steps[0];
    expect(step?.ok).toBe(false);
    expect(step?.summary).toContain("não encontrado");
  });

  it("com confiança baixa o código interrompe e transfere para um analista", async () => {
    const r = await turn(ana, "asdf qwer o sistema lá", [{ tools: [decide("nao_entendi", 0.3)] }, { text: "isto não deveria aparecer" }]);
    const conversation = getOrCreateActiveConversation("u-ana");
    expect(conversation.status).toBe("waiting");
    expect(conversation.transferReason).toBe("baixa_confianca");
    expect(r.done?.decision.outcome).toBe("baixa_confianca");
    expect(r.done?.message.text).toContain("analista");
    expect(r.done?.message.text).not.toContain("não deveria");
    const roles = listMessages(conversation.id).map((m) => m.role);
    expect(roles).toEqual(["employee", "agent", "system"]);
  });

  it("calcula a prioridade no código e não cria sem confirmação num turno seguinte", async () => {
    const draftInput = {
      tipo: "INC",
      titulo: "VPN não conecta no notebook — erro 809",
      descricao: "Desde ontem o notebook com Windows 11 não conecta na VPN e mostra o erro 809.",
      categoria: "Rede e VPN",
      afetados: "eu",
      impede_trabalho: true,
      compromisso_hoje: true,
      tem_alternativa: false,
    };
    const first = await turn(ana, "VPN com erro 809, tenho reunião às 14h", [
      { tools: [decide("abrir_chamado")] },
      { tools: [{ name: "preparar_rascunho", input: draftInput }] },
      // O modelo tenta confirmar no mesmo turno: o código barra.
      { tools: [{ name: "confirmar_rascunho", input: { rascunho_id: "D-381" } }] },
      { text: "Confira o rascunho." },
    ]);
    const draft = first.cards.find((c): c is Extract<Card, { kind: "draft" }> => c.kind === "draft")?.draft;
    expect(draft?.priority).toBe("alta");
    expect(first.done?.decision.steps.at(-1)?.summary).toContain("ainda não viu");
    const conversationId = getOrCreateActiveConversation("u-ana").id;
    expect(pendingDraft(conversationId)?.id).toBe(draft?.id);

    const second = await turn(ana, "Pode criar", [
      { tools: [decide("confirmar_ou_editar_rascunho")] },
      { tools: [{ name: "confirmar_rascunho", input: { rascunho_id: draft!.id } }] },
      { text: "Pronto." },
    ]);
    expect(second.labels).toContain("criou o chamado INC-20517");
    expect(tickets.get("INC-20517")?.priority).toBe("alta");
    expect(pendingDraft(conversationId)).toBeNull();
  });

  it("aponta o chamado aberto em vez de duplicar", async () => {
    createSession("u-diego", "employee");
    const r = await turn(diego, "Minha VPN fica caindo", [
      { tools: [decide("abrir_chamado")] },
      {
        tools: [
          {
            name: "preparar_rascunho",
            input: {
              tipo: "INC",
              titulo: "VPN caindo toda hora",
              descricao: "A VPN conecta mas cai a cada poucos minutos.",
              categoria: "Rede e VPN",
              afetados: "eu",
              impede_trabalho: false,
              compromisso_hoje: false,
              tem_alternativa: true,
            },
          },
        ],
      },
      { text: "Você já tem o INC-20488 sobre isso." },
    ]);
    expect(r.labels).toContain("verificou duplicidade");
    expect(r.cards[0]).toMatchObject({ kind: "ticket", ticket: { id: "INC-20488" } });
    expect(pendingDraft(getOrCreateActiveConversation("u-diego").id)).toBeNull();
  });

  it("com um analista na conversa, o agent não responde", async () => {
    const conversation = getOrCreateActiveConversation("u-ana");
    updateConversation(conversation.id, { status: "analyst", assignedAnalystId: "a-rafael" });
    const r = await turn(ana, "Oi?", [{ tools: [decide("conversa")] }]);
    expect(r.calls).toHaveLength(0);
    expect(r.events.map((e) => e.t)).toEqual(["user", "paused"]);
    expect(getConversation(conversation.id)?.status).toBe("analyst");
  });

  it("respeita o limite de mensagens por sessão", async () => {
    for (let i = 0; i < SESSION_MESSAGE_LIMIT; i++) {
      await turn(ana, `mensagem ${i}`, [{ tools: [decide("conversa")] }, { text: "ok" }]);
    }
    const r = await turn(ana, "mais uma", [{ tools: [decide("conversa")] }, { text: "ok" }]);
    expect(r.events).toEqual([expect.objectContaining({ t: "error" })]);
    expect(r.calls).toHaveLength(0);
  });

  it("legado fora do ar: tenta de novo e avisa, sem inventar resposta", async () => {
    outage = true;
    const r = await turn(ana, "Qual o status do meu chamado?", [
      { tools: [decide("consultar_chamado")] },
      { tools: [{ name: "listar_meus_chamados", input: { escopo: "abertos" } }] },
      { text: "O sistema de chamados está fora do ar agora." },
    ]);
    expect(r.labels).toContain("sistema de chamados indisponível");
    expect(r.done?.decision.outcome).toBe("sistema_indisponivel");
    expect(r.done?.decision.steps[0]?.summary).toMatch(/3 nova\(s\) tentativa\(s\)/);
  });
});
