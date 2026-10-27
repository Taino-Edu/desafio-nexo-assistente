import { describe, expect, it } from "vitest";
import { addBusinessMinutes, ticketDueAt, ticketSlaState, handoffDeadline } from "./sla";
import { classifyPriority } from "./priority";
import { findDuplicate } from "./duplicates";
import type { TicketView } from "./domain";

const brt = (s: string) => new Date(`${s}-03:00`);
const iso = (d: Date) => d.toISOString();

describe("prazos (horário útil seg-sex 8h-18h, Brasília)", () => {
  it("alta: 4 horas úteis no mesmo dia (caso do protótipo, 09:43 → 13:43)", () => {
    expect(iso(ticketDueAt("alta", brt("2026-10-27T09:43:00")))).toBe(iso(brt("2026-10-27T13:43:00")));
  });

  it("alta: o que sobra passa para o dia útil seguinte", () => {
    expect(iso(ticketDueAt("alta", brt("2026-10-27T16:00:00")))).toBe(iso(brt("2026-10-28T10:00:00")));
  });

  it("alta aberta na sexta à tarde vence na segunda", () => {
    expect(iso(ticketDueAt("alta", brt("2026-10-30T17:00:00")))).toBe(iso(brt("2026-11-02T11:00:00")));
  });

  it("chamado aberto no fim de semana começa a contar na segunda às 8h", () => {
    expect(iso(addBusinessMinutes(brt("2026-10-31T10:00:00"), 120))).toBe(iso(brt("2026-11-02T10:00:00")));
  });

  it("média: 3 dias úteis, pulando o fim de semana", () => {
    expect(iso(ticketDueAt("media", brt("2026-10-16T14:20:00")))).toBe(iso(brt("2026-10-21T14:20:00")));
  });

  it("crítica conta em tempo corrido (plantão 24 h)", () => {
    expect(iso(ticketDueAt("critica", brt("2026-10-31T23:30:00")))).toBe(iso(brt("2026-11-01T00:30:00")));
  });

  it("chamado sem atualização além do prazo está vencido", () => {
    const state = ticketSlaState(
      { priority: "media", status: "aguardando_analista", updatedAt: iso(brt("2026-10-16T14:20:00")) },
      brt("2026-10-21T10:00:00"),
    );
    expect(state.overdue).toBe(false);
    const later = ticketSlaState(
      { priority: "media", status: "aguardando_analista", updatedAt: iso(brt("2026-10-16T14:20:00")) },
      brt("2026-10-21T14:21:00"),
    );
    expect(later.overdue).toBe(true);
  });

  it("chamado resolvido não tem prazo", () => {
    expect(
      ticketSlaState({ priority: "alta", status: "resolvido", updatedAt: iso(brt("2026-01-01T10:00:00")) }, new Date()),
    ).toEqual({ dueAt: null, overdue: false });
  });

  it("transferência: 2 h úteis, ou 1 h corrida se for crítico", () => {
    expect(iso(handoffDeadline("media", brt("2026-10-27T10:05:00")))).toBe(iso(brt("2026-10-27T12:05:00")));
    expect(iso(handoffDeadline("critica", brt("2026-10-27T21:00:00")))).toBe(iso(brt("2026-10-27T22:00:00")));
  });
});

describe("prioridade (Anexo A)", () => {
  const base = { type: "INC", affected: "eu", blocksWork: false, deadlineToday: false, hasWorkaround: false } as const;

  it("VPN fora com reunião hoje à tarde: alta", () => {
    expect(classifyPriority({ ...base, blocksWork: true, deadlineToday: true }).priority).toBe("alta");
  });

  it("parado para a equipe: crítica", () => {
    expect(classifyPriority({ ...base, affected: "equipe", blocksWork: true }).priority).toBe("critica");
  });

  it("impede uma pessoa de trabalhar, sem alternativa: alta", () => {
    expect(classifyPriority({ ...base, blocksWork: true }).priority).toBe("alta");
  });

  it("atrapalha mas tem alternativa: média", () => {
    expect(classifyPriority({ ...base, blocksWork: true, hasWorkaround: true }).priority).toBe("media");
  });

  it("pedido sem urgência: baixa", () => {
    expect(classifyPriority({ ...base, type: "REQ" }).priority).toBe("baixa");
  });

  it("pedido com compromisso hoje sobe para alta", () => {
    expect(classifyPriority({ ...base, type: "REQ", deadlineToday: true }).priority).toBe("alta");
  });
});

describe("duplicidade", () => {
  const now = brt("2026-10-27T10:00:00");
  const ticket = (over: Partial<TicketView>): TicketView => ({
    id: "INC-1",
    type: "INC",
    title: "VPN não conecta",
    description: "Erro 809 ao conectar na VPN pelo notebook",
    category: "Rede e VPN",
    subcategory: null,
    priority: "alta",
    status: "aberto",
    affected: "eu",
    requesterId: "e1",
    queue: null,
    createdAt: iso(now),
    updatedAt: iso(now),
    resolvedAt: null,
    updates: [],
    dueAt: null,
    overdue: false,
    ...over,
  });
  const draft = {
    category: "Rede e VPN" as const,
    title: "VPN não conecta no notebook — erro 809",
    description: "Desde ontem a VPN mostra o erro 809.",
  };

  it("encontra chamado aberto sobre o mesmo problema", () => {
    expect(findDuplicate([ticket({})], draft, now)?.kind).toBe("aberto");
  });

  it("ignora chamados de outra categoria", () => {
    expect(findDuplicate([ticket({ category: "Hardware" })], draft, now)).toBeNull();
  });

  it("sugere reabrir se foi resolvido há até 7 dias", () => {
    const resolved = ticket({ status: "resolvido", resolvedAt: iso(brt("2026-10-23T10:00:00")) });
    expect(findDuplicate([resolved], draft, now)?.kind).toBe("reabrir");
  });

  it("não reabre o que foi resolvido há mais de 7 dias", () => {
    const old = ticket({ status: "resolvido", resolvedAt: iso(brt("2026-10-15T10:00:00")) });
    expect(findDuplicate([old], draft, now)).toBeNull();
  });

  it("assuntos diferentes na mesma categoria não são duplicados", () => {
    const other = ticket({ title: "Wi-Fi da sala 3 lento", description: "Sinal fraco na sala de reuniões" });
    expect(findDuplicate([other], draft, now)).toBeNull();
  });
});
