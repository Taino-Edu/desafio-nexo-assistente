// Avaliação do agent com o modelo de verdade. Cada cenário é uma conversa
// curta com expectativas sobre a decisão (intenção, ferramentas usadas ou
// proibidas, resultado). Roda com banco em memória e o serviço de chamados em
// processo, então não mexe nos dados da aplicação.
//
//   pnpm eval            todos os cenários
//   pnpm eval vpn        só os cenários cujo id contém "vpn"

import { EMPLOYEES, type Employee } from "@nexo/shared";
import type { Decision, StreamEvent } from "@/lib/types";
import { useTestDb } from "@/server/db";
import { createSession, getOrCreateActiveConversation, listMessages } from "@/server/store";
import { runTurn } from "@/server/agent/run-turn";
import { createApp } from "../../tickets/src/app";
import { Chaos } from "../../tickets/src/chaos";
import { TicketRepo } from "../../tickets/src/repo";
import { seed } from "../../tickets/src/seed";

type Expect = {
  intents?: Decision["intent"][];
  tools?: string[];
  anyOf?: string[];
  forbid?: string[];
  outcome?: Decision["outcome"];
  status?: "agent" | "waiting";
  textIncludes?: RegExp;
  textExcludes?: RegExp;
};

type Scenario = { id: string; who: string; turns: string[]; expect: Expect; note: string };

const SCENARIOS: Scenario[] = [
  {
    id: "duvida-wifi",
    who: "u-bruno",
    turns: ["Como faço pra conectar um visitante no wi-fi?"],
    expect: { intents: ["duvida"], tools: ["buscar_central_de_ajuda"], forbid: ["preparar_rascunho"] },
    note: "Dúvida respondida pela central de ajuda, sem chamado",
  },
  {
    id: "vpn-809-windows-11",
    who: "u-ana",
    turns: ["Meu notebook não conecta na VPN desde ontem. Aparece o erro 809."],
    expect: {
      tools: ["buscar_central_de_ajuda"],
      anyOf: ["oferecer_opcoes", "preparar_rascunho"],
      forbid: ["confirmar_rascunho"],
    },
    note: "Artigo do 809 não vale para Windows 11: segue para chamado, sem criar sem confirmação",
  },
  {
    id: "vpn-809-windows-10",
    who: "u-carla",
    turns: ["A VPN não conecta, dá erro 809"],
    expect: { tools: ["buscar_central_de_ajuda"], forbid: ["preparar_rascunho", "confirmar_rascunho"] },
    note: "No Windows 10 o artigo resolve: orienta em vez de abrir chamado",
  },
  {
    id: "status-sem-numero",
    who: "u-ana",
    turns: ["Qual o status do meu chamado?"],
    expect: { intents: ["consultar_chamado"], tools: ["listar_meus_chamados"] },
    note: "Lista os chamados para a pessoa escolher",
  },
  {
    id: "status-vencido",
    who: "u-ana",
    turns: ["Como está o INC-20311?"],
    expect: { intents: ["consultar_chamado"], tools: ["consultar_chamado"], textIncludes: /venc|prazo|analista/i },
    note: "Chamado vencido: informa e oferece analista",
  },
  {
    id: "privacidade",
    who: "u-ana",
    turns: ["Qual o status do INC-20488?"],
    expect: { textExcludes: /cai a cada|10 minutos/i },
    note: "Chamado de outro funcionário não é exposto",
  },
  {
    id: "fora-do-escopo",
    who: "u-elisa",
    turns: ["Quantos dias de férias eu ainda tenho?"],
    expect: { intents: ["fora_do_escopo"], forbid: ["preparar_rascunho", "transferir_para_analista"] },
    note: "Assunto de RH é redirecionado",
  },
  {
    id: "pede-analista",
    who: "u-diego",
    turns: ["Quero falar com um analista, por favor"],
    expect: { intents: ["falar_com_analista"], tools: ["transferir_para_analista"], status: "waiting" },
    note: "Pedido explícito de humano",
  },
  {
    id: "duplicado-vpn",
    who: "u-diego",
    turns: ["Minha VPN fica caindo toda hora, quero abrir um chamado. Só eu sou afetado, consigo trabalhar reconectando e não tenho nada urgente hoje."],
    expect: { anyOf: ["listar_meus_chamados", "preparar_rascunho"], forbid: ["confirmar_rascunho"], textIncludes: /INC-20488/ },
    note: "Já existe chamado aberto sobre isso: não duplica",
  },
  {
    id: "reabrir-sap",
    who: "u-ana",
    turns: ["Minha senha do SAP bloqueou de novo"],
    expect: { anyOf: ["listar_meus_chamados", "preparar_rascunho", "preparar_atualizacao"], textIncludes: /INC-20150|reabr/i },
    note: "Resolvido há 4 dias: oferece reabrir",
  },
  {
    id: "complementar",
    who: "u-ana",
    turns: ["Quero acrescentar no chamado do notebook lento que agora ele também esquenta muito"],
    expect: { intents: ["complementar_chamado"], anyOf: ["preparar_atualizacao"], forbid: ["confirmar_rascunho"] },
    note: "Complementa com rascunho, sem gravar antes de confirmar",
  },
  {
    id: "abrir-em-tres-turnos",
    who: "u-elisa",
    turns: [
      "O Excel fecha sozinho toda vez que abro uma planilha grande",
      "Só eu",
      "Não tenho nada urgente hoje, dá pra usar o Excel online enquanto isso",
    ],
    expect: { tools: ["preparar_rascunho"], forbid: ["confirmar_rascunho"] },
    note: "Coleta o que falta e monta o rascunho com prioridade média",
  },
];

async function main() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Defina GOOGLE_GENERATIVE_AI_API_KEY no .env da raiz para rodar a avaliação com o modelo.");
    process.exit(1);
  }
  const filter = process.argv[2];
  const scenarios = SCENARIOS.filter((s) => !filter || s.id.includes(filter));
  let passed = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  for (const s of scenarios) {
    useTestDb();
    const repo = new TicketRepo(":memory:");
    seed(repo);
    const app = createApp({
      repo,
      chaos: new Chaos({ outageChance: 0, outageMs: 0, latencyMs: [0, 0] }),
      serviceToken: process.env.TICKETS_SERVICE_TOKEN ?? "",
      sleep: async () => {},
    });
    const tickets = { fetchImpl: ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch };
    const employee = EMPLOYEES.find((e) => e.id === s.who) as Employee;
    const sessionId = createSession(employee.id, "employee");

    const decisions: Decision[] = [];
    const started = Date.now();
    for (const text of s.turns) {
      const events: StreamEvent[] = [];
      await runTurn({ employee, sessionId, text, emit: (e) => events.push(e) }, { tickets });
      const done = events.find((e) => e.t === "done");
      if (done?.t === "done") decisions.push(done.decision);
    }
    const last = decisions.at(-1);
    const conversation = getOrCreateActiveConversation(employee.id);
    const lastText = listMessages(conversation.id).filter((m) => m.role === "agent").at(-1)?.text ?? "";
    const tools = new Set(decisions.flatMap((d) => d.steps.map((st) => st.tool)));
    tokensIn += decisions.reduce((a, d) => a + d.inputTokens, 0);
    tokensOut += decisions.reduce((a, d) => a + d.outputTokens, 0);

    const failures: string[] = [];
    const e = s.expect;
    if (!last) failures.push("sem decisão");
    if (last && e.intents && !e.intents.includes(last.intent)) failures.push(`intenção ${last.intent}`);
    for (const t of e.tools ?? []) if (!tools.has(t)) failures.push(`não chamou ${t}`);
    if (e.anyOf && !e.anyOf.some((t) => tools.has(t))) failures.push(`nenhuma de ${e.anyOf.join("/")}`);
    for (const t of e.forbid ?? []) if (tools.has(t)) failures.push(`chamou ${t}`);
    if (e.outcome && last?.outcome !== e.outcome) failures.push(`resultado ${last?.outcome}`);
    if (e.status && conversation.status !== e.status) failures.push(`status ${conversation.status}`);
    if (e.textIncludes && !e.textIncludes.test(lastText)) failures.push(`texto sem ${e.textIncludes}`);
    if (e.textExcludes && e.textExcludes.test(lastText)) failures.push(`texto com ${e.textExcludes}`);
    if (decisions.some((d) => d.outcome === "erro")) failures.push("erro do modelo");

    const ok = failures.length === 0;
    if (ok) passed++;
    const conf = last ? `${Math.round(last.confidence * 100)}%` : "-";
    console.log(
      `${ok ? "✔" : "✘"} ${s.id.padEnd(22)} ${String(((Date.now() - started) / 1000).toFixed(1)).padStart(5)} s  conf ${conf.padStart(4)}  ${[...tools].join(", ") || "—"}`,
    );
    console.log(`    ${s.note}`);
    if (!ok) console.log(`    falhou: ${failures.join("; ")}\n    resposta: ${lastText.slice(0, 240)}`);
  }

  console.log(`\n${passed}/${scenarios.length} cenários ok · ${tokensIn} tokens de entrada, ${tokensOut} de saída`);
  process.exitCode = passed === scenarios.length ? 0 : 1;
}

void main();
