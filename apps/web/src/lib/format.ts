import type { Priority, TicketStatus } from "@nexo/shared";

// Formatação para a interface, sempre no horário de Brasília.

const TZ = "America/Sao_Paulo";

export function time(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** "16 out" */
export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" })
    .format(new Date(iso))
    .replace(".", "")
    .replace(" de ", " ");
}

/** "16 out, 14:20" */
export function dateTime(iso: string): string {
  return `${shortDate(iso)}, ${time(iso)}`;
}

function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

/** "10:05" hoje, "ontem", ou "16 out". */
export function listTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return time(iso);
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey(d) === dayKey(yesterday)) return "ontem";
  return shortDate(iso);
}

/** "há 5 dias", "há 3 h", "agora" */
export function ago(iso: string, now = new Date()): string {
  const min = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.floor(h / 24);
  return days === 1 ? "há 1 dia" : `há ${days} dias`;
}

export function sameDayLabel(iso: string, now = new Date()): string {
  return dayKey(new Date(iso)) === dayKey(now) ? "Hoje" : shortDate(iso);
}

export const STATUS_DOT: Record<TicketStatus, string> = {
  aberto: "bg-primary",
  em_andamento: "bg-primary",
  aguardando_analista: "bg-warning",
  aprovado: "bg-success",
  resolvido: "bg-success",
  fechado: "bg-ink-3",
};

export const STATUS_TEXT: Record<TicketStatus, string> = {
  aberto: "text-primary-text",
  em_andamento: "text-primary-text",
  aguardando_analista: "text-warning-text",
  aprovado: "text-success-text",
  resolvido: "text-success-text",
  fechado: "text-ink-3",
};

export const PRIORITY_DOT: Record<Priority, string> = {
  critica: "bg-danger",
  alta: "bg-warning",
  media: "bg-primary",
  baixa: "bg-ink-3",
};
