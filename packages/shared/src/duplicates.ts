import { isOpen, type Category, type TicketView } from "./domain";

// Regra de duplicidade do Anexo A: se já existe chamado aberto sobre o mesmo
// problema, ele é atualizado; se foi resolvido há até 7 dias, pode ser reaberto.
// A comparação é deliberadamente simples (mesma categoria + palavras em comum):
// ela só sugere um candidato, e o agent confirma com o funcionário.

const REOPEN_WINDOW_DAYS = 7;
const MIN_SIMILARITY = 0.25;

const STOPWORDS = new Set(
  "a o e de da do das dos em no na nos nas um uma uns umas para por com sem que se meu minha meus minhas não nao está esta ao aos à às é foi ser após apos desde".split(
    " ",
  ),
);

export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

export function similarity(a: string, b: string): number {
  const ka = keywords(a);
  const kb = keywords(b);
  if (ka.size === 0 || kb.size === 0) return 0;
  let common = 0;
  for (const w of ka) if (kb.has(w)) common++;
  return common / Math.min(ka.size, kb.size);
}

export type DuplicateMatch = {
  ticket: TicketView;
  kind: "aberto" | "reabrir";
  similarity: number;
};

export function findDuplicate(
  tickets: TicketView[],
  draft: { category: Category; title: string; description: string },
  now: Date,
): DuplicateMatch | null {
  const text = `${draft.title} ${draft.description}`;
  let best: DuplicateMatch | null = null;

  for (const t of tickets) {
    if (t.category !== draft.category) continue;
    let kind: DuplicateMatch["kind"];
    if (isOpen(t.status)) {
      kind = "aberto";
    } else if (t.status === "resolvido" && t.resolvedAt && daysAgo(t.resolvedAt, now) <= REOPEN_WINDOW_DAYS) {
      kind = "reabrir";
    } else {
      continue;
    }
    const score = similarity(text, `${t.title} ${t.description}`);
    if (score >= MIN_SIMILARITY && (!best || score > best.similarity)) {
      best = { ticket: t, kind, similarity: Number(score.toFixed(2)) };
    }
  }
  return best;
}

function daysAgo(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000);
}
