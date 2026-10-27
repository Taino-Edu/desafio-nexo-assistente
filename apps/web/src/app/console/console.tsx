"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  ArrowUp,
  ChevronRight,
  CircleX,
  Clock,
  Headset,
  LogOut,
  MessagesSquare,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Undo2,
} from "lucide-react";
import { initials, PRIORITY_LABEL, STATUS_LABEL, isOpen, type Analyst, type Employee } from "@nexo/shared";
import type { ChatMessage, ConversationSummary, Decision, TicketSummary } from "@/lib/types";
import { listTime, sameDayLabel, shortDate, time, STATUS_DOT, STATUS_TEXT } from "@/lib/format";
import { logout } from "@/app/login/actions";
import { NexoMark } from "@/components/nexo-mark";
import { AgentStatusLine } from "@/components/decision";
import { DraftCard, HandoffCard, TicketCard, TicketListCard, cardKey } from "@/components/cards";

// Console do analista (Telas 4 e 5): conversas, histórico com as decisões do
// agent, assumir/devolver/encerrar e os chamados do funcionário.

type Detail = {
  conversation: ConversationSummary;
  employee: Employee | null;
  messages: ChatMessage[];
  decisions: Decision[];
  tickets: TicketSummary[] | null;
};

type Filter = "todas" | "para_voce" | "agent" | "minhas";

const POLL_MS = 2500;
const AVATAR_COLORS = [
  "bg-avatar text-cta",
  "bg-warning-soft text-warning-text",
  "bg-violet-soft text-violet-text",
  "bg-success-soft text-success-text",
  "bg-danger-soft text-danger-text",
  "bg-desk text-ink-2",
];

function avatarColor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function tag(c: ConversationSummary, me: string) {
  if (c.status === "waiting") {
    if (c.transferReason === "baixa_confianca") {
      return { dot: "bg-warning", text: "text-warning-text", label: `Agent pediu ajuda · confiança ${Math.round((c.lastConfidence ?? 0) * 100)}%` };
    }
    return { dot: "bg-danger", text: "text-danger-text", label: `Transferida${c.relatedTicketId ? ` · ${c.relatedTicketId}` : ""}` };
  }
  if (c.status === "analyst") {
    return c.assignedAnalystId === me
      ? { dot: "bg-primary", text: "text-primary-text", label: "Você está atendendo" }
      : { dot: "bg-primary", text: "text-primary-text", label: `Com ${c.assignedAnalystName ?? "analista"}` };
  }
  if (c.status === "agent") return { dot: "bg-success", text: "text-success-text", label: "Agent atendendo" };
  return { dot: "bg-ink-3", text: "text-ink-3", label: "Encerrada" };
}

export function Console({ analyst, initial }: { analyst: Analyst; initial: ConversationSummary[] }) {
  const [list, setList] = useState(initial);
  const [filter, setFilter] = useState<Filter>(initial.some((c) => c.status === "waiting") ? "para_voce" : "todas");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.find((c) => c.status === "waiting")?.id ?? initial[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<Detail | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/console/conversations", { cache: "no-store" });
    if (res.ok) setList(((await res.json()) as { conversations: ConversationSummary[] }).conversations);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/console/conversations/${id}`, { cache: "no-store" });
    if (res.ok) setDetail((await res.json()) as Detail);
  }, []);

  useEffect(() => {
    const t = setInterval(loadList, POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    void loadDetail(selectedId);
    const t = setInterval(() => loadDetail(selectedId), POLL_MS);
    return () => clearInterval(t);
  }, [selectedId, loadDetail]);

  const counts = useMemo(
    () => ({
      todas: list.length,
      para_voce: list.filter((c) => c.status === "waiting").length,
      agent: list.filter((c) => c.status === "agent").length,
      minhas: list.filter((c) => c.status === "analyst" && c.assignedAnalystId === analyst.id).length,
    }),
    [list, analyst.id],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((c) => {
        if (filter === "para_voce") return c.status === "waiting";
        if (filter === "agent") return c.status === "agent";
        if (filter === "minhas") return c.status === "analyst" && c.assignedAnalystId === analyst.id;
        return true;
      })
      .filter((c) => !q || c.employeeName.toLowerCase().includes(q) || (c.relatedTicketId ?? "").toLowerCase().includes(q));
  }, [list, filter, query, analyst.id]);

  const act = useCallback(
    async (body: { action: "assumir" | "devolver" | "encerrar" } | { action: "mensagem"; text: string }) => {
      if (!selectedId) return false;
      setError(null);
      const res = await fetch(`/api/console/conversations/${selectedId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Não foi possível concluir.");
      await Promise.all([loadDetail(selectedId), loadList()]);
      return res.ok;
    },
    [selectedId, loadDetail, loadList],
  );

  const filters: { key: Filter; label: string }[] = [
    { key: "todas", label: "Todas" },
    { key: "para_voce", label: "Para você" },
    { key: "agent", label: "Com o agent" },
    { key: "minhas", label: "Minhas" },
  ];

  return (
    <div className="flex h-screen bg-paper">
      {/* Trilho */}
      <nav className="flex w-16 shrink-0 flex-col items-center gap-1.5 border-r border-rule bg-desk py-4">
        <div className="grid size-10 place-items-center pb-2">
          <NexoMark size={22} />
        </div>
        <span className="relative grid size-10 place-items-center rounded-xl bg-paper" title="Conversas">
          <MessagesSquare size={19} />
          {counts.para_voce > 0 && (
            <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full border-2 border-desk bg-cta px-1 text-[10px] font-bold text-white">
              {counts.para_voce}
            </span>
          )}
        </span>
        <span className="flex-1" />
        <form action={logout}>
          <button className="grid size-9 place-items-center rounded-full text-ink-3 hover:bg-paper" title="Sair">
            <LogOut size={16} />
          </button>
        </form>
        <span className="relative grid size-9 place-items-center rounded-full bg-primary-soft text-[12.5px] font-bold text-primary-text" title={analyst.name}>
          {initials(analyst.name)}
          <span className="absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-desk bg-success" />
        </span>
      </nav>

      {/* Lista de conversas */}
      <section className="flex w-[380px] shrink-0 flex-col border-r border-rule">
        <div className="flex flex-col gap-3 px-4 pt-4 pb-2.5">
          <div className="flex items-center gap-2">
            <h1 className="flex-1 text-xl font-bold">Conversas</h1>
            <span className="flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-[5px] text-[12.5px] font-semibold text-success-text">
              <span className="size-[7px] rounded-full bg-success" /> Disponível
            </span>
          </div>
          <label className="flex h-9 items-center gap-2.5 rounded-full bg-desk px-3">
            <Search size={15} className="text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar conversa ou chamado"
              className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-ink-3"
            />
          </label>
          <div className="flex gap-1">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`flex items-center gap-1.5 rounded-full px-[9px] py-1.5 text-[12.5px] font-medium ${
                  filter === f.key ? "bg-primary-soft text-primary-text" : "bg-desk text-ink-2 hover:bg-rule"
                }`}
              >
                {f.label}
                {f.key !== "todas" && <span className={`font-semibold ${filter === f.key ? "" : "text-ink-3"}`}>{counts[f.key]}</span>}
              </button>
            ))}
          </div>
        </div>
        <ul className="scroll-thin flex-1 overflow-y-auto px-2 pb-2">
          {visible.length === 0 && <li className="px-3 py-8 text-center text-[13.5px] text-ink-3">Nenhuma conversa aqui.</li>}
          {visible.map((c) => {
            const t = tag(c, analyst.id);
            const preview = c.lastMessage ? `${c.lastMessage.role === "agent" ? "Nexo: " : ""}${c.lastMessage.text}` : "Sem mensagens";
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`flex w-full gap-3 rounded-xl p-2.5 text-left ${selectedId === c.id ? "bg-desk" : "hover:bg-desk/60"}`}
                >
                  <span className={`relative grid size-[46px] shrink-0 place-items-center rounded-full text-[15.5px] font-semibold ${avatarColor(c.employeeId)}`}>
                    {initials(c.employeeName)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-[3px] border-b border-rule pb-2.5">
                    <span className="flex items-center gap-2">
                      <span className="flex-1 truncate text-[15.5px] font-semibold">{c.employeeName}</span>
                      <span className={`text-[12.5px] ${c.status === "waiting" ? "font-semibold text-cta" : "text-ink-3"}`}>
                        {listTime(c.updatedAt)}
                      </span>
                    </span>
                    <span className="truncate text-[13.5px] text-ink-3">{preview}</span>
                    <span className={`flex items-center gap-[5px] text-[11.5px] font-medium ${t.text}`}>
                      <span className={`size-1.5 rounded-full ${t.dot}`} /> {t.label}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Conversa */}
      {detail && selectedId === detail.conversation.id ? (
        <ConversationView
          detail={detail}
          analyst={analyst}
          error={error}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((o) => !o)}
          act={act}
        />
      ) : (
        <section className="grid flex-1 place-items-center bg-convo text-[13.5px] text-ink-3">
          {selectedId ? "Carregando…" : "Selecione uma conversa."}
        </section>
      )}

      {detail && panelOpen && selectedId === detail.conversation.id && <TicketPanel detail={detail} onClose={() => setPanelOpen(false)} />}
    </div>
  );
}

function ConversationView({
  detail,
  analyst,
  error,
  panelOpen,
  onTogglePanel,
  act,
}: {
  detail: Detail;
  analyst: Analyst;
  error: string | null;
  panelOpen: boolean;
  onTogglePanel: () => void;
  act: (body: { action: "assumir" | "devolver" | "encerrar" } | { action: "mensagem"; text: string }) => Promise<boolean>;
}) {
  const { conversation: c, messages } = detail;
  const decisions = useMemo(() => new Map(detail.decisions.map((d) => [d.id, d])), [detail.decisions]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = c.status === "analyst" && c.assignedAnalystId === analyst.id;
  const first = c.employeeName.split(" ")[0];

  const run = async (body: Parameters<typeof act>[0]) => {
    setBusy(true);
    const ok = await act(body);
    setBusy(false);
    return ok;
  };

  const scrollRef = useCallback((el: HTMLDivElement | null) => {
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  let lastDay = "";

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-convo">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-rule bg-paper pr-4 pl-5">
        <span className={`grid size-10 place-items-center rounded-full text-[14.5px] font-semibold ${avatarColor(c.employeeId)}`}>
          {initials(c.employeeName)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15.5px] font-semibold">{c.employeeName}</span>
          <span className="truncate text-[12.5px] text-ink-3">
            {[c.department, c.relatedTicketId].filter(Boolean).join(" · ")}
          </span>
        </span>
        {c.status === "waiting" && (
          <span className="flex items-center gap-[7px] rounded-full bg-warning-soft px-[11px] py-1.5 text-[12.5px] font-semibold text-warning-text">
            <Clock size={14} /> Aguardando atendente
          </span>
        )}
        {mine && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => run({ action: "devolver" })}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-line pr-3 pl-2.5 text-[13.5px] font-medium text-ink-2 hover:bg-desk"
            >
              <Undo2 size={14} /> Devolver ao agent
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run({ action: "encerrar" })}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-danger-soft pr-3 pl-2.5 text-[13.5px] font-semibold text-danger-text hover:bg-danger/15"
            >
              <CircleX size={14} /> Encerrar atendimento
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onTogglePanel}
          className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-desk"
          title={panelOpen ? "Fechar painel de chamados" : "Abrir painel de chamados"}
        >
          {panelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </button>
      </header>

      <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto px-10 pt-5 pb-4">
        {messages.map((m) => {
          const day = sameDayLabel(m.createdAt);
          const dayPill =
            day !== lastDay ? (
              <p key={`day-${m.id}`} className="flex justify-center pt-2">
                <span className="rounded-full bg-paper px-3 py-1 text-[12px] font-medium text-ink-3 shadow-xs">{day}</span>
              </p>
            ) : null;
          lastDay = day;

          if (m.role === "system") {
            return (
              <div key={m.id}>
                {dayPill}
                <p className="flex items-center gap-3 pt-[18px] pb-1 text-[12px] font-medium text-ink-3">
                  <span className="h-px flex-1 bg-ink/8" />
                  <ArrowRightLeft size={13} />
                  {m.text}
                  <span className="h-px flex-1 bg-ink/8" />
                </p>
              </div>
            );
          }
          if (m.role === "employee") {
            return (
              <div key={m.id}>
                {dayPill}
                <div className="flex pt-4">
                  <p className="flex max-w-[70%] items-end gap-2.5 rounded-[4px_12px_12px_12px] bg-paper px-3 pt-2 pb-1.5 text-[14.5px] leading-[1.45]">
                    <span className="whitespace-pre-wrap">{m.text}</span>
                    <span className="shrink-0 text-[11px] text-ink-3">{time(m.createdAt)}</span>
                  </p>
                </div>
              </div>
            );
          }
          const isAgent = m.role === "agent";
          const decision = m.decisionId ? (decisions.get(m.decisionId) ?? null) : null;
          return (
            <div key={m.id}>
              {dayPill}
              <div className="flex flex-col items-end gap-1 pt-4">
                {isAgent ? (
                  <div className="flex flex-col items-end px-1">
                    <AgentStatusLine decision={decision} name="Nexo Assist" tone="console" />
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 px-1 text-[12px] font-semibold text-ink-2">
                    {m.authorName}
                    <span className="rounded-md bg-success-soft px-1.5 py-px text-[11px] text-success-text">Analista</span>
                  </p>
                )}
                {m.text && (
                  <p
                    className={`flex max-w-[70%] items-end gap-2.5 rounded-[12px_4px_12px_12px] px-3 pt-2 pb-1.5 text-[14.5px] leading-[1.45] ${
                      isAgent ? "bg-agent-bubble" : "bg-human-bubble"
                    }`}
                  >
                    <span className="whitespace-pre-wrap">{m.text}</span>
                    <span className="shrink-0 text-[11px] text-ink-3">{time(m.createdAt)}</span>
                  </p>
                )}
                {m.cards.length > 0 && (
                  <div className="flex w-full max-w-[560px] flex-col gap-2">
                    {m.cards.map((card, i) => {
                      switch (card.kind) {
                        case "ticket":
                          return <TicketCard key={cardKey(card, i)} ticket={card.ticket} />;
                        case "ticket-list":
                          return <TicketListCard key={cardKey(card, i)} tickets={card.tickets} selectable={false} />;
                        case "draft":
                          return <DraftCard key={cardKey(card, i)} draft={card.draft} disabled />;
                        case "options":
                          return (
                            <p key={cardKey(card, i)} className="self-end rounded-lg bg-paper px-3 py-2 text-[12.5px] text-ink-3">
                              Opções: {card.options.join(" · ")}
                            </p>
                          );
                        case "handoff":
                          return <HandoffCard key={cardKey(card, i)} queue={card.queue} deadline={card.deadline} reason={card.reason} />;
                      }
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2.5 border-t border-rule bg-paper px-5 pt-3 pb-3.5">
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-text">{error}</p>}
        {c.status === "waiting" && (
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-warning-soft text-warning-text">
              <Headset size={17} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[14.5px] font-semibold">{first} espera um atendente</span>
              <span className="text-[12.5px] text-ink-3">
                Agent pausado{c.transferDeadline ? ` · até ${time(c.transferDeadline)}` : ""}
                {c.transferQueue ? ` · Suporte ${c.transferQueue}` : ""}
              </span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => run({ action: "devolver" })}
              className="flex h-9 items-center gap-[7px] rounded-lg border border-line pr-3.5 pl-3 text-[13.5px] font-medium text-ink-2 hover:bg-desk"
            >
              <Undo2 size={15} /> Devolver ao agent
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run({ action: "assumir" })}
              className="flex h-9 items-center gap-[7px] rounded-lg bg-cta pr-4 pl-3.5 text-[13.5px] font-semibold text-white hover:bg-cta-hover"
            >
              <Headset size={16} /> Assumir atendimento
            </button>
          </div>
        )}
        {c.status === "agent" && (
          <div className="flex items-center gap-3">
            <span className="flex-1 text-[13.5px] text-ink-3">O agent está atendendo esta conversa.</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => run({ action: "assumir" })}
              className="flex h-9 items-center gap-[7px] rounded-lg border border-line px-3.5 text-[13.5px] font-medium text-ink-2 hover:bg-desk"
            >
              <Headset size={15} /> Assumir mesmo assim
            </button>
          </div>
        )}
        {c.status === "analyst" && !mine && (
          <p className="text-[13.5px] text-ink-3">{c.assignedAnalystName} está atendendo esta conversa.</p>
        )}
        {c.status === "closed" && <p className="text-[13.5px] text-ink-3">Atendimento encerrado.</p>}

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim() || !mine) return;
            if (await run({ action: "mensagem", text })) setText("");
          }}
          className="flex items-center gap-3"
        >
          <input
            value={text}
            disabled={!mine || busy}
            onChange={(e) => setText(e.target.value)}
            placeholder={mine ? `Responder ${first}…` : "Assuma o atendimento para responder"}
            className="h-11 flex-1 rounded-xl bg-desk px-3.5 text-[14.5px] outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-cta/30 disabled:cursor-not-allowed"
          />
          {mine && (
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="grid size-11 place-items-center rounded-full bg-cta text-white hover:bg-cta-hover disabled:opacity-50"
              aria-label="Enviar"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </form>
      </div>
    </section>
  );
}

function TicketPanel({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const { conversation: c, tickets } = detail;
  const first = c.employeeName.split(" ")[0];
  const current = tickets?.find((t) => t.id === c.relatedTicketId) ?? null;
  const others = tickets?.filter((t) => t.id !== current?.id) ?? [];
  const openCount = tickets?.filter((t) => isOpen(t.status)).length ?? 0;

  return (
    <aside className="hidden w-[340px] shrink-0 flex-col border-l border-rule bg-paper xl:flex">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-rule pr-3.5 pl-5">
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="text-[15.5px] font-semibold">Chamados de {first}</span>
          <span className="text-[12.5px] text-ink-3">
            {tickets ? `${openCount} abertos · ${tickets.length - openCount} encerrados` : "sistema de chamados indisponível"}
          </span>
        </span>
        <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-desk" aria-label="Fechar">
          <PanelRightClose size={18} />
        </button>
      </header>

      <div className="scroll-thin flex flex-1 flex-col gap-8 overflow-y-auto px-5 pt-6 pb-5">
        {c.transferSummary && c.status !== "agent" && (
          <section className="flex flex-col gap-2">
            <h3 className="text-[12.5px] font-semibold text-ink-3">Resumo da transferência</h3>
            <p className="rounded-xl border border-warning/30 bg-warning-soft p-3 text-[13.5px] leading-normal">{c.transferSummary}</p>
          </section>
        )}

        {current && (
          <section className="flex flex-col gap-3">
            <h3 className="text-[12.5px] font-semibold text-ink-3">Desta conversa</h3>
            <div className="flex flex-col gap-3.5 rounded-xl bg-desk p-4">
              <div className="flex flex-col gap-1.5">
                <p className="flex items-center text-[12.5px]">
                  <span className="flex-1 font-data font-medium text-ink-3">{current.id}</span>
                  <span className={`flex items-center gap-1.5 font-semibold ${current.overdue ? "text-danger-text" : STATUS_TEXT[current.status]}`}>
                    <span className={`size-[7px] rounded-full ${current.overdue ? "bg-danger" : STATUS_DOT[current.status]}`} />
                    {current.overdue ? "Prazo vencido" : STATUS_LABEL[current.status]}
                  </span>
                </p>
                <p className="text-[15.5px] font-semibold">{current.title}</p>
                <p className="text-[13.5px] text-ink-3">
                  {current.category} · prioridade {PRIORITY_LABEL[current.priority].toLowerCase()}
                </p>
              </div>
              <p className="border-t border-rule pt-3 text-[13.5px] leading-normal text-ink-2">{current.description}</p>
            </div>
          </section>
        )}

        <section className="flex flex-col gap-1">
          <h3 className="text-[12.5px] font-semibold text-ink-3">{current ? "Outros chamados" : "Chamados"}</h3>
          {!tickets && <p className="py-3 text-[13.5px] text-ink-3">Não foi possível carregar agora.</p>}
          {tickets && others.length === 0 && <p className="py-3 text-[13.5px] text-ink-3">Nenhum.</p>}
          {others.map((t) => (
            <div key={t.id} className="flex items-center gap-3 border-b border-rule py-3 last:border-0">
              <span className={`size-[7px] shrink-0 rounded-full ${t.overdue ? "bg-danger" : STATUS_DOT[t.status]}`} />
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="truncate text-[14.5px] font-medium">{t.title}</span>
                <span className="text-[12.5px] text-ink-3">
                  {t.id} · {isOpen(t.status) ? (t.overdue ? "Prazo vencido" : STATUS_LABEL[t.status]) : `${STATUS_LABEL[t.status]} em ${shortDate(t.updatedAt)}`}
                </span>
              </span>
              <ChevronRight size={16} className="text-ink-3" />
            </div>
          ))}
        </section>
      </div>
    </aside>
  );
}
