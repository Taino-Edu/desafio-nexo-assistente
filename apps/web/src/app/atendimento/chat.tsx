"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Headset, Info, UserRound } from "lucide-react";
import type { Card, ChatMessage, ConversationStatus, Decision, StreamEvent, TicketSummary } from "@/lib/types";
import { time } from "@/lib/format";
import { TopBar } from "@/components/employee-shell";
import { AgentStatusLine } from "@/components/decision";
import { DraftCard, HandoffCard, OptionsCard, TicketCard, TicketListCard, cardKey } from "@/components/cards";
import { RichText } from "@/components/rich-text";

export type ChatState = {
  conversation: { id: string; status: ConversationStatus; transferDeadline: string | null };
  messages: ChatMessage[];
  decisions: Decision[];
  session: { used: number; limit: number };
};

type Live = { labels: string[]; text: string; cards: Card[] };

const POLL_MS = 3000;

export function Chat({ initial }: { initial: ChatState }) {
  const [messages, setMessages] = useState(initial.messages);
  const [decisions, setDecisions] = useState(() => new Map(initial.decisions.map((d) => [d.id, d])));
  const [status, setStatus] = useState(initial.conversation.status);
  const [deadline, setDeadline] = useState(initial.conversation.transferDeadline);
  const [session, setSession] = useState(initial.session);
  const [live, setLive] = useState<Live | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyDraft, setBusyDraft] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sending = live !== null;
  const limitReached = session.used >= session.limit;

  const refresh = useCallback(async () => {
    const res = await fetch("/api/chat", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as ChatState;
    setMessages(data.messages);
    setDecisions(new Map(data.decisions.map((d) => [d.id, d])));
    setStatus(data.conversation.status);
    setDeadline(data.conversation.transferDeadline);
    setSession(data.session);
  }, []);

  // Com um analista (ou esperando por um), as respostas chegam por polling.
  useEffect(() => {
    if (status === "agent" || sending) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [status, sending, refresh]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, live]);

  const send = useCallback(
    async (text: string) => {
      const value = text.trim();
      if (!value || sending || limitReached) return;
      setError(null);
      setInput("");
      setLive({ labels: [], text: "", cards: [] });
      // Mostra a mensagem na hora; o servidor devolve a versão gravada.
      const optimisticId = `local-${Date.now()}`;
      setMessages((m) => [
        ...m,
        { id: optimisticId, conversationId: "", role: "employee", authorName: null, text: value, cards: [], decisionId: null, createdAt: new Date().toISOString() },
      ]);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: value }),
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { message?: string };
          throw new Error(data.message ?? "Não foi possível enviar a mensagem.");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) handle(JSON.parse(line) as StreamEvent);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha de conexão.");
        setMessages((m) => m.filter((x) => x.id !== optimisticId));
        setInput(value);
      } finally {
        setLive(null);
        setSelected(null);
      }

      function handle(e: StreamEvent) {
        switch (e.t) {
          case "user":
            setMessages((m) => m.map((x) => (x.id === optimisticId ? e.message : x)));
            setSession((s) => ({ ...s, used: s.used + 1 }));
            break;
          case "step":
            setLive((l) => (l ? { ...l, labels: [...l.labels, e.label] } : l));
            break;
          case "text":
            setLive((l) => (l ? { ...l, text: l.text + e.delta } : l));
            break;
          case "card":
            setLive((l) => (l ? { ...l, cards: [...l.cards, e.card] } : l));
            break;
          case "done":
            setDecisions((d) => new Map(d).set(e.decision.id, e.decision));
            setMessages((m) => [...m, e.message]);
            setStatus(e.status);
            // A resposta e as linhas de sistema (ex.: transferência) vêm do servidor.
            void refresh();
            break;
          case "paused":
            setStatus(e.status);
            break;
          case "error":
            setError(e.message);
            break;
        }
      }
    },
    [sending, limitReached, refresh],
  );

  const actOnDraft = useCallback(
    async (draftId: string, action: "confirmar" | "cancelar") => {
      setBusyDraft(draftId);
      setError(null);
      try {
        const res = await fetch(`/api/drafts/${draftId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "Não foi possível concluir.");
        }
        await refresh();
      } finally {
        setBusyDraft(null);
      }
    },
    [refresh],
  );

  // Só o último cartão interativo do agent aceita cliques.
  const lastAgentId = useMemo(() => [...messages].reverse().find((m) => m.role === "agent")?.id, [messages]);
  const pendingDraftId = useMemo(() => {
    for (const m of [...messages].reverse()) {
      for (const c of m.cards) if (c.kind === "draft" && c.draft.status === "pendente") return c.draft.id;
    }
    return null;
  }, [messages]);

  // Ctrl/⌘+Enter confirma o rascunho pendente, como sugere o protótipo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && pendingDraftId && status === "agent" && !busyDraft) {
        e.preventDefault();
        void actOnDraft(pendingDraftId, "confirmar");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDraftId, status, busyDraft, actOnDraft]);

  const renderCard = (card: Card, i: number, interactive: boolean) => {
    switch (card.kind) {
      case "ticket":
        return <TicketCard key={cardKey(card, i)} ticket={card.ticket} />;
      case "ticket-list":
        return (
          <TicketListCard
            key={cardKey(card, i)}
            tickets={card.tickets}
            selectable={card.selectable}
            selectedId={interactive ? selected : null}
            disabled={!interactive || sending}
            onSelect={(t: TicketSummary) => {
              setSelected(t.id);
              void send(`${t.id} · ${t.title}`);
            }}
          />
        );
      case "draft":
        return (
          <DraftCard
            key={cardKey(card, i)}
            draft={card.draft}
            busy={busyDraft === card.draft.id}
            disabled={status !== "agent" || sending}
            onConfirm={() => actOnDraft(card.draft.id, "confirmar")}
            onCancel={() => actOnDraft(card.draft.id, "cancelar")}
            onEdit={() => {
              setInput(`Quero mudar no rascunho ${card.draft.id}: `);
              inputRef.current?.focus();
            }}
          />
        );
      case "options":
        return null; // fica dentro do balão
      case "handoff":
        return <HandoffCard key={cardKey(card, i)} queue={card.queue} deadline={card.deadline} reason={card.reason} />;
    }
  };

  const renderAgent = (m: ChatMessage, decision: Decision | null, liveLabels?: string[]) => {
    const interactive = m.id === lastAgentId && status === "agent";
    const options = m.cards.find((c): c is Extract<Card, { kind: "options" }> => c.kind === "options");
    return (
      <div key={m.id} className="flex flex-col gap-1.5">
        <AgentStatusLine decision={decision} liveLabels={liveLabels} />
        {(m.text || options) && (
          <div className="flex w-fit max-w-[600px] flex-col gap-3 rounded-[4px_12px_12px_12px] border border-rule bg-paper px-4 py-3">
            {m.text && (
              <p className="text-[14.5px] leading-normal whitespace-pre-wrap">
                <RichText text={m.text} />
              </p>
            )}
            {options && (
              <OptionsCard
                question={options.question}
                options={options.options}
                disabled={!interactive || sending}
                onPick={(o) => void send(o)}
              />
            )}
          </div>
        )}
        {m.cards.map((c, i) => renderCard(c, i, interactive))}
      </div>
    );
  };

  return (
    <>
      <TopBar here="Atendimento">
        <StatusPill status={status} />
      </TopBar>

      <div ref={scroller} className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[840px] flex-col gap-5 px-5 pt-7 pb-2">
          {messages.length === 0 && !live && <Welcome onPick={(t) => void send(t)} />}

          {messages.map((m) => {
            switch (m.role) {
              case "employee":
                return (
                  <div key={m.id} className="flex justify-end">
                    <p className="max-w-[520px] rounded-[12px_12px_4px_12px] bg-ink px-4 py-[11px] text-[14.5px] leading-[1.45] whitespace-pre-wrap text-white">
                      {m.text}
                    </p>
                  </div>
                );
              case "agent":
                return renderAgent(m, m.decisionId ? (decisions.get(m.decisionId) ?? null) : null);
              case "analyst":
                return (
                  <div key={m.id} className="flex flex-col gap-1.5">
                    <p className="flex items-center gap-2 text-[12.5px] font-semibold">
                      {m.authorName}
                      <span className="rounded-md bg-success-soft px-1.5 py-px text-[11px] text-success-text">Analista</span>
                    </p>
                    <p className="w-fit max-w-[600px] rounded-[4px_12px_12px_12px] bg-human-bubble px-4 py-3 text-[14.5px] leading-normal whitespace-pre-wrap">
                      {m.text}
                    </p>
                  </div>
                );
              case "system":
                return (
                  <p key={m.id} className="flex items-center gap-3 text-[12px] font-medium text-ink-3">
                    <span className="h-px flex-1 bg-ink/8" />
                    {m.text}
                    <span className="h-px flex-1 bg-ink/8" />
                  </p>
                );
            }
          })}

          {live &&
            renderAgent(
              { id: "live", conversationId: "", role: "agent", authorName: null, text: live.text, cards: live.cards, decisionId: null, createdAt: "" },
              null,
              live.labels,
            )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[840px] px-5 pt-2.5 pb-[18px]">
        {status !== "agent" && <WaitingBanner status={status} deadline={deadline} />}
        {error && (
          <p role="alert" className="mb-2 flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger-text">
            <Info size={14} /> {error}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex min-h-12 items-center gap-2 rounded-xl border border-line bg-paper py-1.5 pr-1.5 pl-4 focus-within:border-cta"
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            disabled={limitReached}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={limitReached ? "Limite de mensagens desta sessão atingido" : "Escreva para o Nexo…"}
            aria-label="Mensagem"
            className="max-h-32 flex-1 resize-none bg-transparent py-1.5 text-[14.5px] outline-none placeholder:text-ink-3"
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || limitReached}
            className="flex h-9 items-center gap-1.5 rounded-md bg-cta px-3 text-[13.5px] font-semibold text-white hover:bg-cta-hover disabled:opacity-50"
          >
            <ArrowUp size={14} /> Enviar
          </button>
        </form>
        <p className={`mt-1.5 text-right text-[12.5px] ${limitReached ? "text-danger-text" : "text-ink-3"}`}>
          {session.used}/{session.limit} mensagens nesta sessão
        </p>
      </div>
    </>
  );
}

function StatusPill({ status }: { status: ConversationStatus }) {
  const map = {
    agent: { cls: "bg-success-soft text-success-text", dot: "bg-success", label: "Assistente online" },
    waiting: { cls: "bg-warning-soft text-warning-text", dot: "bg-warning", label: "Aguardando analista" },
    analyst: { cls: "bg-success-soft text-success-text", dot: "bg-success", label: "Analista atendendo" },
    closed: { cls: "bg-desk text-ink-3", dot: "bg-ink-3", label: "Atendimento encerrado" },
  }[status];
  return (
    <span className={`flex items-center gap-[7px] rounded-full px-2.5 py-[5px] text-[12.5px] font-semibold ${map.cls}`}>
      <span className={`size-[7px] rounded-full ${map.dot}`} />
      {map.label}
    </span>
  );
}

function WaitingBanner({ status, deadline }: { status: ConversationStatus; deadline: string | null }) {
  if (status === "closed") {
    return (
      <p className="mb-2 rounded-lg bg-desk px-3 py-2 text-[13px] text-ink-2">
        Este atendimento foi encerrado. Se escrever de novo, o Nexo Assist começa uma conversa nova.
      </p>
    );
  }
  return (
    <p className="mb-2 flex items-center gap-2.5 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
      {status === "waiting" ? <Headset size={15} /> : <UserRound size={15} />}
      {status === "waiting"
        ? `Um analista vai assumir esta conversa${deadline ? ` até ${time(deadline)}` : ""}. O assistente está pausado; pode deixar informações aqui.`
        : "Um analista está atendendo você agora."}
    </p>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  const suggestions = [
    "Qual o status do meu chamado?",
    "Minha VPN não conecta, aparece o erro 809",
    "Como troco a senha da rede?",
    "Quero falar com um analista",
  ];
  return (
    <div className="flex flex-col gap-3 pt-6">
      <p className="font-display text-[32px] leading-tight tracking-[-0.6px]">Como posso ajudar?</p>
      <p className="text-[14.5px] text-ink-3">
        Descreva o problema com suas palavras. Eu consulto seus chamados, busco na central de ajuda e chamo um analista quando for preciso.
      </p>
      <div className="flex flex-wrap gap-1.5 pt-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-lg border border-rule px-3 py-[7px] text-[13.5px] font-medium hover:border-primary hover:bg-primary-soft hover:text-primary-text"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
