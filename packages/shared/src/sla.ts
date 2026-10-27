import { isOpen, type Priority, type TicketStatus } from "./domain";

// Prazos do Anexo A. Críticos têm plantão 24 h, então o prazo corre em tempo
// corrido; os demais contam só o horário do service desk (seg a sex, 8h às 18h,
// conforme o artigo "Horário do service desk" da central de ajuda).

const BRT_OFFSET_MS = -3 * 60 * 60 * 1000; // Brasil sem horário de verão desde 2019
const DAY_START_H = 8;
const DAY_END_H = 18;
const BUSINESS_DAY_MIN = (DAY_END_H - DAY_START_H) * 60;

type SlaRule = { mode: "corrido" | "util"; minutes: number; label: string };

export const SLA: Record<Priority, SlaRule> = {
  critica: { mode: "corrido", minutes: 60, label: "1 hora" },
  alta: { mode: "util", minutes: 4 * 60, label: "4 horas úteis" },
  media: { mode: "util", minutes: 3 * BUSINESS_DAY_MIN, label: "3 dias úteis" },
  baixa: { mode: "util", minutes: 5 * BUSINESS_DAY_MIN, label: "5 dias úteis" },
};

/** Prazo para um analista assumir uma conversa transferida. */
export const HANDOFF_SLA: Record<"critica" | "padrao", SlaRule> = {
  critica: { mode: "corrido", minutes: 60, label: "1 hora" },
  padrao: { mode: "util", minutes: 2 * 60, label: "2 horas úteis" },
};

// "Local" aqui é um Date cujos campos UTC representam o horário de Brasília.
const toLocal = (d: Date) => new Date(d.getTime() + BRT_OFFSET_MS);
const fromLocal = (d: Date) => new Date(d.getTime() - BRT_OFFSET_MS);

function isBusinessDay(local: Date): boolean {
  const day = local.getUTCDay();
  return day >= 1 && day <= 5;
}

function atHour(local: Date, hour: number): Date {
  const d = new Date(local);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

function nextBusinessDayStart(local: Date): Date {
  let d = atHour(local, DAY_START_H);
  do {
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  } while (!isBusinessDay(d));
  return d;
}

/** Leva um instante para o próximo momento dentro do expediente. */
function clampToBusiness(local: Date): Date {
  if (!isBusinessDay(local) || local >= atHour(local, DAY_END_H)) return nextBusinessDayStart(local);
  if (local < atHour(local, DAY_START_H)) return atHour(local, DAY_START_H);
  return local;
}

export function addBusinessMinutes(from: Date, minutes: number): Date {
  let t = clampToBusiness(toLocal(from));
  let remaining = minutes;
  for (;;) {
    const available = (atHour(t, DAY_END_H).getTime() - t.getTime()) / 60_000;
    if (remaining <= available) {
      return fromLocal(new Date(t.getTime() + remaining * 60_000));
    }
    remaining -= available;
    t = nextBusinessDayStart(t);
  }
}

export function applySla(rule: SlaRule, from: Date): Date {
  return rule.mode === "corrido"
    ? new Date(from.getTime() + rule.minutes * 60_000)
    : addBusinessMinutes(from, rule.minutes);
}

/** Prazo da próxima resposta: conta a partir da última atualização do chamado. */
export function ticketDueAt(priority: Priority, lastUpdate: Date): Date {
  return applySla(SLA[priority], lastUpdate);
}

export function ticketSlaState(
  t: { priority: Priority; status: TicketStatus; updatedAt: string },
  now: Date,
): { dueAt: string | null; overdue: boolean } {
  if (!isOpen(t.status)) return { dueAt: null, overdue: false };
  const due = ticketDueAt(t.priority, new Date(t.updatedAt));
  return { dueAt: due.toISOString(), overdue: now.getTime() > due.getTime() };
}

export function handoffDeadline(priority: Priority | null, from: Date): Date {
  return applySla(priority === "critica" ? HANDOFF_SLA.critica : HANDOFF_SLA.padrao, from);
}

/** "16 out, 14:20" no horário de Brasília. */
export function formatBrt(iso: string, opts: { time?: boolean; date?: boolean } = { time: true, date: true }): string {
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    ...(opts.date ? { day: "2-digit", month: "short" } : {}),
    ...(opts.time ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
  return fmt.format(new Date(iso)).replace(".", "");
}

/** Dias corridos entre duas datas, arredondado para baixo. */
export function daysBetween(fromIso: string, to: Date): number {
  return Math.floor((to.getTime() - new Date(fromIso).getTime()) / (24 * 60 * 60 * 1000));
}
