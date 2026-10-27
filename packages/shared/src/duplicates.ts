import { isOpen, type Category, type TicketView } from "./domain";

// Regra de duplicidade do Anexo A: se já existe chamado aberto sobre o mesmo
// problema, ele é atualizado; se foi resolvido há até 7 dias, pode ser reaberto.
// A comparação é deliberadamente simples (mesma categoria + palavras em comum):
// ela só sugere um candidato, e o agent confirma com o funcionário.

const REOPEN_WINDOW_DAYS = 7;
const MIN_SIMILARITY = 0.3;
const MIN_COMMON_WORDS = 2;

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
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

/**
 * Duas palavras "batem" se uma começa com a outra, olhando no máximo os 5
 * primeiros caracteres: um radical pobre, mas suficiente para "cai/caindo",
 * "reconectar/reconectando" e "lento/lentidão".
 */
function sameRoot(a: string, b: string): boolean {
  const ra = a.slice(0, 5);
  const rb = b.slice(0, 5);
  return ra.startsWith(rb) || rb.startsWith(ra);
}

/** Proporção de palavras em comum (sobre o texto menor) e quantas são. */
export function similarity(a: string, b: string): { score: number; common: number } {
  const ka = [...keywords(a)];
  const kb = [...keywords(b)];
  if (ka.length === 0 || kb.length === 0) return { score: 0, common: 0 };
  const common = ka.filter((w) => kb.some((v) => sameRoot(w, v))).length;
  return { score: common / Math.min(ka.length, kb.length), common };
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
    // Uma palavra só ("notebook") não basta: "não liga" e "lento" são problemas diferentes.
    const { score, common } = similarity(text, `${t.title} ${t.description}`);
    if (score >= MIN_SIMILARITY && common >= MIN_COMMON_WORDS && (!best || score > best.similarity)) {
      best = { ticket: t, kind, similarity: Number(score.toFixed(2)) };
    }
  }
  return best;
}

function daysAgo(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000);
}
