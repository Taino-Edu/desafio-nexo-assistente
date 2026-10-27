import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { Chaos } from "./chaos";
import { TicketRepo } from "./repo";
import { seed } from "./seed";

const NOW = new Date("2026-10-27T13:00:00.000Z");
const TOKEN = "test-token";

function setup(chaos = new Chaos({ outageChance: 0, outageMs: 0, latencyMs: [0, 0] })) {
  const repo = new TicketRepo(":memory:");
  seed(repo, NOW);
  const app = createApp({ repo, chaos, serviceToken: TOKEN, now: () => NOW, sleep: async () => {} });
  const call = (path: string, actor: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { authorization: `Bearer ${TOKEN}`, "x-actor": actor, "content-type": "application/json" },
    });
  return { app, repo, call };
}

describe("serviço de chamados", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("exige o token de serviço", async () => {
    const res = await ctx.app.request("/tickets", { headers: { "x-actor": "employee:u-ana" } });
    expect(res.status).toBe(401);
  });

  it("funcionário vê só os próprios chamados, já com prazo calculado", async () => {
    const res = await ctx.call("/tickets", "employee:u-ana");
    const { tickets } = (await res.json()) as { tickets: { id: string; requesterId: string; overdue: boolean }[] };
    expect(tickets.length).toBe(5);
    expect(tickets.every((t) => t.requesterId === "u-ana")).toBe(true);
    expect(tickets.find((t) => t.id === "INC-20311")?.overdue).toBe(true);
  });

  it("chamado de outra pessoa responde 404, sem confirmar que existe", async () => {
    const res = await ctx.call("/tickets/INC-20488", "employee:u-ana");
    expect(res.status).toBe(404);
    const update = await ctx.call("/tickets/INC-20488/updates", "employee:u-ana", {
      method: "POST",
      body: JSON.stringify({ text: "invasão" }),
    });
    expect(update.status).toBe(404);
  });

  it("analista consulta os chamados de qualquer funcionário", async () => {
    const res = await ctx.call("/tickets?requesterId=u-diego", "analyst:a-rafael");
    const { tickets } = (await res.json()) as { tickets: unknown[] };
    expect(tickets.length).toBe(1);
  });

  it("cria chamado com número sequencial e status aberto", async () => {
    const res = await ctx.call("/tickets", "employee:u-ana", {
      method: "POST",
      body: JSON.stringify({
        type: "INC",
        title: "VPN não conecta — erro 809",
        description: "Desde ontem o notebook não conecta na VPN.",
        category: "Rede e VPN",
        priority: "alta",
        affected: "eu",
      }),
    });
    expect(res.status).toBe(201);
    const { ticket } = (await res.json()) as { ticket: { id: string; status: string; dueAt: string } };
    expect(ticket.id).toBe("INC-20517");
    expect(ticket.status).toBe("aberto");
    expect(ticket.dueAt).toBeTruthy();
  });

  it("rejeita chamado incompleto", async () => {
    const res = await ctx.call("/tickets", "employee:u-ana", {
      method: "POST",
      body: JSON.stringify({ title: "VPN" }),
    });
    expect(res.status).toBe(400);
  });

  it("reabre chamado resolvido há até 7 dias, mas não um antigo", async () => {
    const ok = await ctx.call("/tickets/INC-20150/reopen", "employee:u-ana", {
      method: "POST",
      body: JSON.stringify({ text: "Bloqueou de novo." }),
    });
    expect(ok.status).toBe(200);
    const old = await ctx.call("/tickets/INC-19877/reopen", "employee:u-ana", {
      method: "POST",
      body: JSON.stringify({ text: "Voltou o problema." }),
    });
    expect(old.status).toBe(409);
  });

  it("transferência marca o chamado como aguardando analista na fila", async () => {
    const res = await ctx.call("/tickets/INC-20298/transfer", "employee:u-ana", {
      method: "POST",
      body: JSON.stringify({ queue: "N2", summary: "Sem acesso há 13 dias." }),
    });
    const { ticket } = (await res.json()) as { ticket: { status: string; queue: string } };
    expect(ticket).toMatchObject({ status: "aguardando_analista", queue: "N2" });
  });
});

describe("indisponibilidade simulada", () => {
  it("abre uma janela de 503 e se recupera depois", async () => {
    let clock = 0;
    let roll = 0; // primeira requisição sorteia a falha
    const chaos = new Chaos({ outageChance: 0.5, outageMs: 1000, latencyMs: [0, 0] }, () => roll, () => clock);
    const { call } = setup(chaos);

    expect((await call("/tickets", "employee:u-ana")).status).toBe(503);
    roll = 0.9;
    clock = 500;
    expect((await call("/tickets", "employee:u-ana")).status).toBe(503);
    clock = 1500;
    expect((await call("/tickets", "employee:u-ana")).status).toBe(200);
  });
});
