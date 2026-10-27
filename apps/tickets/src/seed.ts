import type { Ticket } from "@nexo/shared";
import type { TicketRepo } from "./repo";

// Dados de exemplo (Anexo B). As datas são relativas ao momento do seed para
// que a demonstração sempre tenha um chamado vencido, um resolvido há poucos
// dias (pode ser reaberto) e chamados de outros funcionários.

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export function seed(repo: TicketRepo, now = new Date()): void {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  const t = (
    partial: Omit<Ticket, "updates" | "queue" | "subcategory" | "resolvedAt"> &
      Partial<Pick<Ticket, "updates" | "queue" | "subcategory" | "resolvedAt">>,
  ): Ticket => ({
    queue: null,
    subcategory: null,
    resolvedAt: null,
    updates: [{ at: partial.createdAt, author: "funcionario", text: partial.description }],
    ...partial,
  });

  const tickets: Ticket[] = [
    // Ana Souza: o cenário do protótipo.
    t({
      id: "INC-20311",
      type: "INC",
      title: "Notebook lento após atualização do Windows",
      description:
        "Lentidão geral desde a atualização do Windows. Reiniciar e rodar o diagnóstico da central não resolveu.",
      category: "Hardware",
      subcategory: "Notebook",
      priority: "media",
      status: "aguardando_analista",
      affected: "eu",
      requesterId: "u-ana",
      queue: "N1",
      createdAt: ago(11 * DAY),
      updatedAt: ago(6 * DAY),
      updates: [
        { at: ago(11 * DAY), author: "funcionario", text: "Notebook muito lento depois da atualização do Windows." },
        { at: ago(6 * DAY), author: "analista", text: "Diagnóstico remoto agendado. Aguardando janela com a usuária." },
      ],
    }),
    t({
      id: "INC-20298",
      type: "INC",
      title: "Acesso à pasta Financeiro no SharePoint",
      description: "Perdi o acesso à pasta Financeiro/Fechamento no SharePoint depois da troca de equipe.",
      category: "Acesso",
      priority: "media",
      status: "em_andamento",
      affected: "eu",
      requesterId: "u-ana",
      queue: "N1",
      createdAt: ago(13 * DAY),
      updatedAt: ago(1 * DAY),
    }),
    t({
      id: "REQ-10442",
      type: "REQ",
      title: "Segundo monitor para home office",
      description: "Pedido de um segundo monitor de 24 polegadas para o home office.",
      category: "Hardware",
      priority: "baixa",
      status: "aprovado",
      affected: "eu",
      requesterId: "u-ana",
      createdAt: ago(18 * DAY),
      updatedAt: ago(4 * DAY),
    }),
    t({
      id: "INC-20150",
      type: "INC",
      title: "Senha do SAP bloqueada",
      description: "Senha do SAP bloqueada depois de três tentativas.",
      category: "Acesso",
      priority: "media",
      status: "resolvido",
      affected: "eu",
      requesterId: "u-ana",
      createdAt: ago(6 * DAY),
      updatedAt: ago(4 * DAY),
      resolvedAt: ago(4 * DAY),
    }),
    t({
      id: "INC-19877",
      type: "INC",
      title: "Outlook não sincroniza no celular",
      description: "O Outlook do celular parou de sincronizar os e-mails.",
      category: "E-mail",
      priority: "media",
      status: "resolvido",
      affected: "eu",
      requesterId: "u-ana",
      createdAt: ago(58 * DAY),
      updatedAt: ago(55 * DAY),
      resolvedAt: ago(55 * DAY),
    }),
    // Outros funcionários: existem para provar que um não vê o chamado do outro.
    t({
      id: "REQ-10460",
      type: "REQ",
      title: "Acesso ao módulo de vendas do SAP",
      description: "Preciso de acesso ao módulo SD do SAP para lançar pedidos ainda hoje.",
      category: "Acesso",
      priority: "alta",
      status: "aberto",
      affected: "eu",
      requesterId: "u-carla",
      createdAt: ago(2 * HOUR),
      updatedAt: ago(2 * HOUR),
    }),
    t({
      id: "INC-20410",
      type: "INC",
      title: "Impressora do 3º andar não imprime",
      description: "A impressora do 3º andar recebe os trabalhos, mas não imprime.",
      category: "Hardware",
      subcategory: "Impressora",
      priority: "media",
      status: "em_andamento",
      affected: "equipe",
      requesterId: "u-bruno",
      queue: "N1",
      createdAt: ago(3 * DAY),
      updatedAt: ago(1 * DAY),
    }),
    t({
      id: "INC-20488",
      type: "INC",
      title: "VPN cai a cada 10 minutos",
      description: "A VPN conecta, mas cai a cada 10 minutos, e preciso reconectar.",
      category: "Rede e VPN",
      priority: "alta",
      status: "aberto",
      affected: "eu",
      requesterId: "u-diego",
      createdAt: ago(1 * DAY),
      updatedAt: ago(1 * DAY),
    }),
    t({
      id: "REQ-10450",
      type: "REQ",
      title: "Licença do Figma",
      description: "Pedido de licença do Figma para o time de comunicação interna.",
      category: "Software",
      priority: "baixa",
      status: "aberto",
      affected: "eu",
      requesterId: "u-elisa",
      createdAt: ago(2 * DAY),
      updatedAt: ago(2 * DAY),
    }),
  ];

  for (const ticket of tickets) repo.insert(ticket);
  repo.setSequence("INC", 20517);
  repo.setSequence("REQ", 10470);
}
