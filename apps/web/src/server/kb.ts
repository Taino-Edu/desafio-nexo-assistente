import "server-only";
import { keywords } from "@nexo/shared";

// Central de ajuda (Anexo B: de 5 a 10 artigos curtos). A busca é por palavras
// em comum, com peso maior para o título e as tags. Para 8 artigos isso basta e
// custa zero tokens; com uma base grande, trocaria por busca vetorial.

export type Article = {
  id: string;
  title: string;
  tags: string[];
  body: string;
  /** Quando o artigo não resolve e é preciso abrir chamado. */
  limits?: string;
};

export const ARTICLES: Article[] = [
  {
    id: "KB-001",
    title: "VPN com erro 809",
    tags: ["vpn", "809", "conectar", "rede", "remoto"],
    body: "Reinstale o cliente de VPN pelo portal de softwares e reinicie o computador.",
    limits: "Vale apenas para Windows 10. No Windows 11, abra um chamado.",
  },
  {
    id: "KB-002",
    title: "Horário do service desk",
    tags: ["horario", "atendimento", "plantao", "suporte", "analista"],
    body: "O service desk atende de segunda a sexta, das 8h às 18h. Chamados críticos têm plantão 24 horas.",
  },
  {
    id: "KB-003",
    title: "Trocar ou desbloquear a senha da rede",
    tags: ["senha", "bloqueada", "rede", "trocar", "expirada", "login", "windows"],
    body: "Acesse senha.nexo.com.br pelo celular, confirme o código enviado por SMS e defina a nova senha. A senha expira a cada 90 dias.",
    limits: "Senhas do SAP não são trocadas por aqui: abra um chamado de Acesso.",
  },
  {
    id: "KB-004",
    title: "Wi-Fi para visitantes",
    tags: ["wifi", "wi-fi", "visitante", "convidado", "internet", "rede"],
    body: "Conecte-se à rede Nexo-Visitantes. A senha do dia aparece na recepção e na intranet, em Serviços > Wi-Fi.",
  },
  {
    id: "KB-005",
    title: "Instalar programas pelo portal de softwares",
    tags: ["instalar", "programa", "software", "portal", "aplicativo", "licenca"],
    body: "Abra o Portal de Softwares no menu Iniciar, procure o programa e clique em Instalar. Não é preciso abrir chamado para programas do catálogo.",
    limits: "Programas fora do catálogo ou com licença paga exigem uma requisição (REQ) de Software.",
  },
  {
    id: "KB-006",
    title: "Configurar o e-mail no celular",
    tags: ["email", "e-mail", "outlook", "celular", "sincronizar", "android", "iphone"],
    body: "Instale o Outlook pela loja do celular, entre com o e-mail corporativo e aprove o acesso no Authenticator.",
    limits: "Se o Outlook já estava configurado e parou de sincronizar, remova a conta e adicione de novo antes de abrir chamado.",
  },
  {
    id: "KB-007",
    title: "Notebook lento",
    tags: ["lento", "lentidao", "travando", "notebook", "computador", "desempenho"],
    body: "Reinicie o computador (não apenas bloqueie a tela), feche abas e programas sem uso e rode o Diagnóstico Nexo no menu Iniciar.",
    limits: "Se continuar lento depois do diagnóstico, abra um chamado de Hardware informando quando começou.",
  },
  {
    id: "KB-008",
    title: "Impressoras",
    tags: ["impressora", "imprimir", "impressao", "fila"],
    body: "Use a fila Nexo-Print: ela libera a impressão em qualquer impressora do andar com o crachá.",
    limits: "Se a impressora não imprimir para ninguém do andar, abra um incidente de Hardware.",
  },
];

export function searchArticles(query: string, limit = 3): { article: Article; score: number }[] {
  const q = keywords(query);
  if (q.size === 0) return [];
  return ARTICLES.map((article) => {
    const title = keywords(article.title);
    const tags = new Set(article.tags.flatMap((t) => [...keywords(t)]));
    const body = keywords(`${article.body} ${article.limits ?? ""}`);
    let score = 0;
    for (const w of q) {
      if (title.has(w)) score += 3;
      if (tags.has(w)) score += 2;
      if (body.has(w)) score += 1;
    }
    return { article, score };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
