import { z } from "zod";

// Vocabulário do service desk (Anexo A do PRD). Fica num pacote compartilhado
// porque o serviço de chamados e o agent precisam falar exatamente a mesma língua.

export const TICKET_TYPES = ["INC", "REQ"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const CATEGORIES = ["Acesso", "Rede e VPN", "Hardware", "Software", "E-mail", "Outros"] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ["critica", "alta", "media", "baixa"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABEL: Record<Priority, string> = {
  critica: "Crítica",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export const TICKET_STATUSES = [
  "aberto",
  "em_andamento",
  "aguardando_analista",
  "aprovado",
  "resolvido",
  "fechado",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  aberto: "Aberto",
  em_andamento: "Em andamento",
  aguardando_analista: "Aguardando analista",
  aprovado: "Aprovado",
  resolvido: "Resolvido",
  fechado: "Fechado",
};

/** Status em que o chamado ainda está "vivo": conta para prazo e para duplicidade. */
export const OPEN_STATUSES: readonly TicketStatus[] = ["aberto", "em_andamento", "aguardando_analista", "aprovado"];

export const AFFECTED = ["eu", "equipe", "empresa", "nao_sei"] as const;
export type Affected = (typeof AFFECTED)[number];

export const AFFECTED_LABEL: Record<Affected, string> = {
  eu: "Somente você",
  equipe: "A equipe",
  empresa: "Toda a empresa",
  nao_sei: "Não informado",
};

export const QUEUES = ["N1", "N2"] as const;
export type Queue = (typeof QUEUES)[number];

export const ticketUpdateSchema = z.object({
  at: z.string(),
  author: z.enum(["funcionario", "agent", "analista", "sistema"]),
  text: z.string(),
});
export type TicketUpdate = z.infer<typeof ticketUpdateSchema>;

export const ticketSchema = z.object({
  id: z.string(),
  type: z.enum(TICKET_TYPES),
  title: z.string(),
  description: z.string(),
  category: z.enum(CATEGORIES),
  subcategory: z.string().nullable(),
  priority: z.enum(PRIORITIES),
  status: z.enum(TICKET_STATUSES),
  affected: z.enum(AFFECTED),
  requesterId: z.string(),
  queue: z.enum(QUEUES).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().nullable(),
  updates: z.array(ticketUpdateSchema),
});
export type Ticket = z.infer<typeof ticketSchema>;

/** O que o serviço devolve: o chamado mais o prazo já calculado. */
export const ticketViewSchema = ticketSchema.extend({
  dueAt: z.string().nullable(),
  overdue: z.boolean(),
});
export type TicketView = z.infer<typeof ticketViewSchema>;

export const newTicketSchema = z.object({
  type: z.enum(TICKET_TYPES),
  title: z.string().min(5).max(120),
  description: z.string().min(10).max(2000),
  category: z.enum(CATEGORIES),
  subcategory: z.string().max(60).nullable().default(null),
  priority: z.enum(PRIORITIES),
  affected: z.enum(AFFECTED),
});
export type NewTicket = z.infer<typeof newTicketSchema>;

export function isOpen(status: TicketStatus): boolean {
  return OPEN_STATUSES.includes(status);
}
