import type { Affected, Priority, TicketType } from "./domain";

// A prioridade é decidida por código, não pelo modelo. O modelo só extrai os
// fatos da conversa (quem é afetado, se a pessoa está parada, se há compromisso
// hoje); a tabela do Anexo A transforma esses fatos em prioridade. Assim a mesma
// situação sempre recebe a mesma prioridade, e dá para explicar o porquê.

export type PriorityFacts = {
  type: TicketType;
  affected: Affected;
  /** Algo parou: a pessoa (ou o grupo afetado) não consegue trabalhar. */
  blocksWork: boolean;
  /** Há um compromisso em risco ainda hoje (reunião, entrega, cliente). */
  deadlineToday: boolean;
  /** Existe uma alternativa razoável enquanto o chamado não é resolvido. */
  hasWorkaround: boolean;
};

export type PriorityResult = { priority: Priority; reason: string };

export function classifyPriority(f: PriorityFacts): PriorityResult {
  const group = f.affected === "equipe" || f.affected === "empresa";

  if (f.blocksWork && group) {
    return {
      priority: "critica",
      reason: `Parado para ${f.affected === "empresa" ? "a empresa" : "uma equipe"}.`,
    };
  }
  if (f.deadlineToday) {
    return { priority: "alta", reason: "Há um compromisso em risco hoje." };
  }
  if (f.blocksWork && !f.hasWorkaround) {
    return { priority: "alta", reason: "Impede a pessoa de trabalhar e não há alternativa." };
  }
  if (f.type === "REQ") {
    return { priority: "baixa", reason: "Pedido sem urgência." };
  }
  return {
    priority: "media",
    reason: f.hasWorkaround ? "Atrapalha, mas há alternativa." : "Atrapalha, sem compromisso em risco.",
  };
}
