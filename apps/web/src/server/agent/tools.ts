import "server-only";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  AFFECTED,
  CATEGORIES,
  PRIORITY_LABEL,
  SLA,
  STATUS_LABEL,
  TICKET_TYPES,
  classifyPriority,
  daysBetween,
  findDuplicate,
  formatBrt,
  isOpen,
  ticketDueAt,
  type Affected,
  type TicketView,
} from "@nexo/shared";
import { INTENTS, type Card, type Draft } from "@/lib/types";
import { searchArticles } from "../kb";
import { getDraft, nextDraftId, saveDraft, supersedePendingDrafts, updateConversation } from "../store";
import { TicketConflictError, TicketNotFoundError, TicketsUnavailableError } from "../tickets-client";
import { HANDOFF_REASONS, executeDraft, formatDue, handoff, toSummary } from "../service-desk";
import type { TurnContext } from "./context";

// Ferramentas do agent. Cada uma registra o que fez (rótulo, entrada, resumo,
// tempo) na decisão do turno e devolve ao modelo só o essencial, para gastar
// poucos tokens. Os cartões vão direto para a interface, sem passar pelo modelo.

type ToolOutput = Record<string, unknown>;
type Outcome = { output: ToolOutput; labels: string[]; summary: string; cards?: Card[] };

async function run(
  ctx: TurnContext,
  tool: string,
  input: unknown,
  fn: () => Promise<Outcome>,
  opts: { writes?: boolean } = {},
): Promise<ToolOutput> {
  // Depois da barreira de confiança, nada mais executa neste turno.
  if (ctx.gate) return { erro: "Turno interrompido." };
  // Quem grava algo (rascunho, chamado, transferência) precisa ter registrado
  // a decisão antes. Leituras podem vir na mesma resposta, para ganhar tempo.
  if (opts.writes && !ctx.decision) {
    ctx.steps.push({ tool, labels: [], input, ok: false, summary: "barrado: decisão não registrada", durationMs: 0 });
    return { erro: "Chame registrar_decisao antes desta ferramenta." };
  }
  const started = Date.now();
  ctx.retries = [];
  const retryNote = () => (ctx.retries.length ? ` (${ctx.retries.length} nova(s) tentativa(s): ${ctx.retries.join(", ")})` : "");
  try {
    const r = await fn();
    for (const label of r.labels) ctx.emit({ t: "step", label });
    for (const card of r.cards ?? []) {
      ctx.cards.push(card);
      ctx.emit({ t: "card", card });
    }
    ctx.steps.push({ tool, labels: r.labels, input, ok: true, summary: r.summary + retryNote(), durationMs: Date.now() - started });
    return r.output;
  } catch (err) {
    let message: string;
    let label: string;
    if (err instanceof TicketsUnavailableError) {
      ctx.ticketsUnavailable = true;
      message = `O sistema de chamados não respondeu depois de ${err.attempts} tentativas. Avise a pessoa e peça para tentar em alguns instantes.`;
      label = "sistema de chamados indisponível";
    } else if (err instanceof TicketNotFoundError) {
      message = `Chamado ${err.ticketId} não encontrado entre os chamados desta pessoa.`;
      label = `não encontrou o ${err.ticketId}`;
    } else if (err instanceof TicketConflictError) {
      message = err.message;
      label = "operação recusada pelo sistema de chamados";
    } else {
      console.error(`[agent] ferramenta ${tool} falhou`, err);
      message = "Erro inesperado ao executar a ação.";
      label = "erro ao executar a ação";
    }
    ctx.emit({ t: "step", label });
    ctx.steps.push({ tool, labels: [label], input, ok: false, summary: message + retryNote(), durationMs: Date.now() - started });
    return { erro: message };
  }
}

function brief(t: TicketView, now: Date) {
  return {
    id: t.id,
    titulo: t.title,
    status: STATUS_LABEL[t.status],
    prioridade: PRIORITY_LABEL[t.priority],
    categoria: t.subcategory ? `${t.category} › ${t.subcategory}` : t.category,
    dias_sem_atualizacao: daysBetween(t.updatedAt, now),
    prazo: isOpen(t.status) ? SLA[t.priority].label : null,
    proxima_resposta_ate: t.dueAt ? formatBrt(t.dueAt) : null,
    vencido: t.overdue,
  };
}

// Os fatos que decidem a prioridade. "nao_informado" existe de propósito: é
// mais fácil o modelo admitir que não sabe do que escolher entre sim e não, e
// com ele o código sabe o que ainda falta perguntar em vez de deixar o modelo
// supor.
const fact = z.enum(["sim", "nao", "nao_informado"]);
const draftFacts = {
  afetados: z
    .enum([...AFFECTED, "nao_informado"])
    .describe("Quem é afetado, segundo a pessoa: eu, equipe, empresa, nao_sei (ela disse que não sabe) ou nao_informado"),
  impede_trabalho: fact.describe("A pessoa disse que não consegue trabalhar por causa disso?"),
  compromisso_hoje: fact.describe("A pessoa disse que há reunião, entrega ou cliente em risco ainda hoje?"),
  tem_alternativa: fact.describe("Existe um jeito de contornar enquanto isso?"),
};

const FACT_QUESTIONS = {
  afetados: "quem é afetado (Só eu, Minha equipe, Toda a empresa, Não sei)",
  impede_trabalho: "se dá para trabalhar enquanto isso",
  compromisso_hoje: "se há algum compromisso hoje que depende disso",
} as const;

export function buildTools(ctx: TurnContext) {
  const registrar_decisao = createTool({
    id: "registrar_decisao",
    description:
      "Registra o que você entendeu e o que vai fazer. Chame SEMPRE primeiro; a primeira ferramenta da ação pode vir na mesma resposta, depois desta.",
    inputSchema: z.object({
      entendimento: z.string().describe("O que a pessoa quer, numa frase"),
      intencao: z
        .enum(INTENTS)
        .describe(
          "duvida: pergunta que a central de ajuda pode responder; consultar_chamado: status/prazo; complementar_chamado: acrescentar informação a um chamado existente; abrir_chamado: problema ou pedido novo; confirmar_ou_editar_rascunho: resposta a um rascunho já mostrado; falar_com_analista; fora_do_escopo: não é TI; conversa: saudação ou agradecimento; nao_entendi",
        ),
      acao: z.string().describe("O que você vai fazer agora"),
      confianca: z.number().min(0).max(1).describe("0 a 1: o quanto você tem certeza do que fazer"),
      motivo: z.string().describe("Por que essa ação, em uma ou duas frases"),
      faltando: z.array(z.string()).default([]).describe("Informações que ainda faltam"),
    }),
    execute: async (input) => {
      ctx.decision = {
        understanding: input.entendimento,
        intent: input.intencao,
        plannedAction: input.acao,
        confidence: input.confianca,
        reason: input.motivo,
        missingInfo: input.faltando,
      };
      updateConversation(ctx.conversation.id, { lastConfidence: input.confianca });
      // Regra do Anexo A: sem segurança, quem decide é um analista. O código
      // interrompe o modelo aqui, em vez de confiar que ele vai se conter.
      const exempt = input.intencao === "falar_com_analista" || input.intencao === "conversa";
      if (input.confianca < ctx.minConfidence && !exempt) {
        ctx.gate = "baixa_confianca";
        ctx.abort.abort();
        return { ok: false, observacao: "Confiança baixa: a conversa será transferida." };
      }
      return { ok: true };
    },
  });

  const listar_meus_chamados = createTool({
    id: "listar_meus_chamados",
    description: "Lista os chamados da pessoa que está falando com você, com status e prazo.",
    inputSchema: z.object({
      escopo: z.enum(["abertos", "todos"]).default("abertos"),
    }),
    execute: (input) =>
      run(ctx, "listar_meus_chamados", input, async () => {
        const now = ctx.now();
        const all = await ctx.client.list();
        const tickets = input.escopo === "abertos" ? all.filter((t) => isOpen(t.status)) : all;
        return {
          labels: ["consultou seus chamados"],
          summary: `${tickets.length} chamado(s) ${input.escopo}: ${tickets.map((t) => t.id).join(", ") || "nenhum"}`,
          cards: tickets.length
            ? [{ kind: "ticket-list", tickets: tickets.map(toSummary), selectable: tickets.length > 1 }]
            : [],
          output: { total: tickets.length, chamados: tickets.map((t) => brief(t, now)) },
        };
      }),
  });

  const consultar_chamado = createTool({
    id: "consultar_chamado",
    description: "Consulta um chamado da pessoa pelo número (ex.: INC-20311), com histórico e prazo.",
    inputSchema: z.object({ id: z.string().regex(/^(INC|REQ)-\d+$/i) }),
    execute: (input) =>
      run(ctx, "consultar_chamado", input, async () => {
        const now = ctx.now();
        const t = await ctx.client.get(input.id.toUpperCase());
        updateConversation(ctx.conversation.id, { relatedTicketId: t.id });
        return {
          labels: [`consultou o ${t.id}`, "calculou o prazo"],
          summary: `${t.id}: ${STATUS_LABEL[t.status]}, ${PRIORITY_LABEL[t.priority]}${t.overdue ? ", prazo vencido" : ""}`,
          cards: [{ kind: "ticket", ticket: toSummary(t) }],
          output: {
            ...brief(t, now),
            descricao: t.description,
            aberto_em: formatBrt(t.createdAt),
            ultimas_atualizacoes: t.updates.slice(-3).map((u) => `${formatBrt(u.at)} (${u.author}): ${u.text}`),
          },
        };
      }),
  });

  const buscar_central_de_ajuda = createTool({
    id: "buscar_central_de_ajuda",
    description: "Busca artigos da central de ajuda de TI. Use antes de abrir chamado para dúvidas e problemas comuns.",
    inputSchema: z.object({ consulta: z.string().min(2) }),
    execute: (input) =>
      run(ctx, "buscar_central_de_ajuda", input, async () => {
        const results = searchArticles(input.consulta);
        return {
          labels: ["buscou na central de ajuda"],
          summary: results.length ? results.map((r) => `${r.article.id} ${r.article.title}`).join("; ") : "nenhum artigo",
          output: {
            artigos: results.map(({ article }) => ({
              id: article.id,
              titulo: article.title,
              texto: article.body,
              limites: article.limits ?? null,
            })),
          },
        };
      }),
  });

  const preparar_rascunho = createTool({
    id: "preparar_rascunho",
    description:
      "Monta o rascunho de um chamado novo para a pessoa conferir. Calcula prioridade e prazo e verifica se já existe chamado sobre o mesmo problema. Não cria nada.",
    inputSchema: z.object({
      tipo: z.enum(TICKET_TYPES),
      titulo: z.string().min(5).max(120),
      descricao: z.string().min(10).max(2000).describe("Descrição completa para o analista não precisar perguntar de novo"),
      categoria: z.enum(CATEGORIES),
      subcategoria: z.string().max(60).optional(),
      ...draftFacts,
      ignorar_duplicidade: z
        .boolean()
        .default(false)
        .describe("true só se a pessoa disse que é outro problema, diferente do chamado parecido"),
    }),
    execute: (input) =>
      run(ctx, "preparar_rascunho", input, async () => {
        const now = ctx.now();
        if (!input.ignorar_duplicidade) {
          const existing = await ctx.client.list();
          const dup = findDuplicate(existing, { category: input.categoria, title: input.titulo, description: input.descricao }, now);
          if (dup) {
            return {
              labels: ["consultou seus chamados", "verificou duplicidade"],
              summary: `possível duplicado: ${dup.ticket.id} (${dup.kind}, similaridade ${dup.similarity})`,
              cards: [{ kind: "ticket", ticket: toSummary(dup.ticket) }],
              output: {
                duplicado: brief(dup.ticket, now),
                situacao: dup.kind === "aberto" ? "já existe chamado aberto" : "resolvido há até 7 dias, pode ser reaberto",
                instrucao:
                  "Não abra outro. Pergunte se é o mesmo problema e, se for, ofereça complementar (ou reabrir) esse chamado com preparar_atualizacao.",
              },
            };
          }
        }
        const missing = (Object.keys(FACT_QUESTIONS) as (keyof typeof FACT_QUESTIONS)[]).filter(
          (k) => input[k] === "nao_informado",
        );
        if (missing.length > 0) {
          return {
            labels: ["verificou o que falta"],
            summary: `faltam: ${missing.join(", ")}`,
            output: {
              faltando: missing.map((k) => FACT_QUESTIONS[k]),
              instrucao:
                "Ainda não monte o rascunho. Pergunte isso à pessoa numa mensagem só; para quem é afetado, use oferecer_opcoes.",
            },
          };
        }
        const { priority, reason } = classifyPriority({
          type: input.tipo,
          affected: input.afetados as Affected,
          blocksWork: input.impede_trabalho === "sim",
          deadlineToday: input.compromisso_hoje === "sim",
          hasWorkaround: input.tem_alternativa === "sim",
        });
        const dueAt = ticketDueAt(priority, now).toISOString();
        supersedePendingDrafts(ctx.conversation.id);
        const draft: Draft = {
          id: nextDraftId(),
          conversationId: ctx.conversation.id,
          kind: "criar",
          status: "pendente",
          ticketId: null,
          type: input.tipo,
          title: input.titulo,
          description: input.descricao,
          category: input.categoria,
          subcategory: input.subcategoria ?? null,
          priority,
          priorityReason: reason,
          affected: input.afetados as Affected,
          note: null,
          dueAt,
          createdAt: now.toISOString(),
          turn: ctx.turn,
        };
        saveDraft(draft);
        return {
          labels: ["classificou a prioridade", "consultou o SLA", "montou o rascunho"],
          summary: `${draft.id}: ${input.tipo} ${input.categoria}, prioridade ${PRIORITY_LABEL[priority]} (${reason})`,
          cards: [{ kind: "draft", draft }],
          output: {
            rascunho_id: draft.id,
            prioridade: PRIORITY_LABEL[priority],
            motivo_prioridade: reason,
            prazo: SLA[priority].label,
            resposta_ate: formatDue(dueAt, now),
            proximo_passo: "Peça para a pessoa conferir e confirmar. Não crie antes disso.",
          },
        };
      }, { writes: true }),
  });

  const preparar_atualizacao = createTool({
    id: "preparar_atualizacao",
    description:
      "Monta um rascunho para complementar um chamado aberto (ou reabrir um resolvido há até 7 dias) com uma informação nova. Não altera nada até a confirmação.",
    inputSchema: z.object({
      chamado_id: z.string().regex(/^(INC|REQ)-\d+$/i),
      texto: z.string().min(3).max(2000).describe("A informação nova, escrita para o analista"),
    }),
    execute: (input) =>
      run(ctx, "preparar_atualizacao", input, async () => {
        const now = ctx.now();
        const t = await ctx.client.get(input.chamado_id.toUpperCase());
        const resolvedRecently =
          t.status === "resolvido" && t.resolvedAt !== null && now.getTime() - new Date(t.resolvedAt).getTime() <= 7 * 86_400_000;
        if (!isOpen(t.status) && !resolvedRecently) {
          return {
            labels: [`consultou o ${t.id}`],
            summary: `${t.id} encerrado há mais de 7 dias; não pode ser reaberto`,
            output: { erro: `O ${t.id} foi encerrado há mais de 7 dias e não pode ser reaberto. Ofereça abrir um chamado novo.` },
          };
        }
        supersedePendingDrafts(ctx.conversation.id);
        const draft: Draft = {
          id: nextDraftId(),
          conversationId: ctx.conversation.id,
          kind: isOpen(t.status) ? "atualizar" : "reabrir",
          status: "pendente",
          ticketId: t.id,
          type: t.type,
          title: t.title,
          description: t.description,
          category: t.category,
          subcategory: t.subcategory,
          priority: t.priority,
          priorityReason: "Mantém a prioridade do chamado.",
          affected: t.affected,
          note: input.texto,
          dueAt: ticketDueAt(t.priority, now).toISOString(),
          createdAt: now.toISOString(),
          turn: ctx.turn,
        };
        saveDraft(draft);
        updateConversation(ctx.conversation.id, { relatedTicketId: t.id });
        return {
          labels: [`consultou o ${t.id}`, "montou o rascunho"],
          summary: `${draft.id}: ${draft.kind} ${t.id}`,
          cards: [{ kind: "draft", draft }],
          output: { rascunho_id: draft.id, operacao: draft.kind, chamado: t.id, proximo_passo: "Peça para a pessoa confirmar." },
        };
      }, { writes: true }),
  });

  const confirmar_rascunho = createTool({
    id: "confirmar_rascunho",
    description:
      "Cria, atualiza ou reabre o chamado de um rascunho. Use só quando a pessoa confirmar explicitamente um rascunho que já foi mostrado a ela.",
    inputSchema: z.object({ rascunho_id: z.string().regex(/^D-\d+$/) }),
    execute: (input) =>
      run(ctx, "confirmar_rascunho", input, async () => {
        const draft = getDraft(input.rascunho_id);
        // Garantias que não dependem do modelo: o rascunho é desta conversa,
        // ainda está pendente e foi mostrado num turno anterior (a pessoa viu).
        if (!draft || draft.conversationId !== ctx.conversation.id) {
          return { labels: [], summary: "rascunho inexistente", output: { erro: "Rascunho não encontrado nesta conversa." } };
        }
        if (draft.status !== "pendente") {
          return { labels: [], summary: `rascunho ${draft.status}`, output: { erro: `Este rascunho já foi ${draft.status}.` } };
        }
        if (draft.turn >= ctx.turn) {
          return {
            labels: [],
            summary: "bloqueado: a pessoa ainda não viu o rascunho",
            output: { erro: "A pessoa ainda não viu este rascunho. Mostre e espere a confirmação." },
          };
        }
        const result = await executeDraft(draft, ctx.client);
        const verb = draft.kind === "criar" ? "criou o chamado" : draft.kind === "reabrir" ? "reabriu o" : "atualizou o";
        return {
          labels: [`${verb} ${result.ticket.id}`],
          summary: `${draft.id} → ${result.ticket.id}`,
          cards: [result.card],
          output: { chamado: result.ticket.id, mensagem_sugerida: result.text },
        };
      }, { writes: true }),
  });

  const cancelar_rascunho = createTool({
    id: "cancelar_rascunho",
    description: "Descarta o rascunho pendente quando a pessoa desistir.",
    inputSchema: z.object({ rascunho_id: z.string().regex(/^D-\d+$/) }),
    execute: (input) =>
      run(ctx, "cancelar_rascunho", input, async () => {
        const draft = getDraft(input.rascunho_id);
        if (!draft || draft.conversationId !== ctx.conversation.id || draft.status !== "pendente") {
          return { labels: [], summary: "nada a cancelar", output: { erro: "Não há rascunho pendente com esse número." } };
        }
        saveDraft({ ...draft, status: "cancelado" });
        return { labels: ["descartou o rascunho"], summary: `${draft.id} cancelado`, output: { ok: true } };
      }, { writes: true }),
  });

  const oferecer_opcoes = createTool({
    id: "oferecer_opcoes",
    description: "Mostra uma pergunta com opções rápidas para a pessoa escolher com um clique.",
    inputSchema: z.object({
      pergunta: z.string().min(3).max(120),
      opcoes: z.array(z.string().min(1).max(60)).min(2).max(5),
    }),
    execute: (input) =>
      run(ctx, "oferecer_opcoes", input, async () => ({
        labels: [],
        summary: `${input.pergunta} [${input.opcoes.join(" | ")}]`,
        cards: [{ kind: "options", question: input.pergunta, options: input.opcoes }],
        output: { ok: true, observacao: "As opções já estão na tela; não as repita no texto." },
      })),
  });

  const transferir_para_analista = createTool({
    id: "transferir_para_analista",
    description:
      "Transfere a conversa para um analista humano. Depois disso você não responde mais nesta conversa até o analista devolver.",
    inputSchema: z.object({
      motivo: z.enum(Object.keys(HANDOFF_REASONS) as [keyof typeof HANDOFF_REASONS, ...(keyof typeof HANDOFF_REASONS)[]]),
      resumo: z.string().min(10).max(1000).describe("O caso em poucas frases, para o analista não precisar perguntar de novo"),
      chamado_id: z.string().regex(/^(INC|REQ)-\d+$/i).optional(),
    }),
    execute: (input) =>
      run(ctx, "transferir_para_analista", input, async () => {
        const ticket = input.chamado_id ? await ctx.client.get(input.chamado_id.toUpperCase()) : null;
        const result = await handoff({
          conversation: ctx.conversation,
          reason: input.motivo,
          summary: input.resumo,
          ticket,
          client: ctx.client,
          now: ctx.now(),
        });
        ctx.handedOff = true;
        ctx.afterSystem.push(result.systemText);
        return {
          labels: ["transferiu para um analista"],
          summary: `Suporte ${result.queue}, motivo: ${HANDOFF_REASONS[input.motivo]}`,
          cards: [result.card],
          output: { fila: `Suporte ${result.queue}`, mensagem_sugerida: result.text },
        };
      }, { writes: true }),
  });

  return {
    registrar_decisao,
    listar_meus_chamados,
    consultar_chamado,
    buscar_central_de_ajuda,
    preparar_rascunho,
    preparar_atualizacao,
    confirmar_rascunho,
    cancelar_rascunho,
    oferecer_opcoes,
    transferir_para_analista,
  };
}
