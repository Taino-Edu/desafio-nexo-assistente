# Nexo Assist

O agente de atendimento do service desk de TI da Nexo, construído para o desafio técnico da Beyond the Bytes.

O funcionário conversa num chat. O agente:

- tira dúvidas pela central de ajuda;
- consulta, abre, complementa ou reabre chamados, sempre mostrando um rascunho antes;
- chama um analista quando precisa.

O analista tem um console para ver as conversas, assumir o atendimento (com o agente pausado), devolver ao agente ou encerrar.

O que mais pesa no desafio, a **transparência**, aparece em cada resposta:

- acima do balão, as ações que o agente executou ("consultou seus chamados · classificou a prioridade");
- um clique em **ver decisão** mostra o que ele entendeu, a intenção, a ação, a confiança, o motivo, cada ferramenta executada (com tempo e resultado) e os tokens gastos.

---

## Como rodar

Pré-requisitos: **Node 22.13+** e **pnpm** (`npm i -g pnpm`).

```bash
pnpm install
cp .env.example .env      # e preencha GOOGLE_GENERATIVE_AI_API_KEY
pnpm dev                  # sobe o serviço de chamados (4001) e o app (3000)
```

Abra http://localhost:3000. Qualquer senha funciona:

| Quem | E-mail | O que testar |
|---|---|---|
| Funcionária | `ana.souza@nexo.com.br` | Tem um chamado vencido, um resolvido há 4 dias e Windows 11 |
| Funcionária | `carla.mendes@nexo.com.br` | Windows 10: o artigo do erro 809 da VPN vale para ela |
| Funcionário | `diego.ramos@nexo.com.br` | Já tem um chamado de VPN aberto (teste a duplicidade) |
| Analista N2 | `rafael.lima@nexo.com.br` | Console do analista |

Outros comandos:

```bash
pnpm test         # testes (regras, serviço de chamados e turnos do agente com modelo roteirizado)
pnpm eval         # cenários de conversa contra o Gemini de verdade (usa a chave do .env)
pnpm typecheck
pnpm reset-data   # apaga os bancos locais; os dados de exemplo voltam no próximo start
```

Os dados ficam em `data/*.db` (SQLite) e sobrevivem a reinícios: conversas, mensagens, decisões, rascunhos, estado de cada conversa e chamados.

---

## Arquitetura

```
apps/web (Next.js 16)                                   apps/tickets (Hono)
┌────────────────────────────────────────────┐   HTTP   ┌──────────────────────────┐
│ Interface: login, chat, console            │  + token │ "Sistema legado" de      │
│     │  NDJSON (stream)        polling      │ ───────▶ │ chamados, com SQLite     │
│ Rotas /api: chat, drafts, console          │ x-actor  │ - privacidade no serviço │
│     │                                      │          │ - SLA calculado          │
│ Agent (Mastra) ── ferramentas ── cliente ──┼──────────│ - quedas simuladas (503) │
│     │                 │        com retry   │          └──────────────────────────┘
│     │          central de ajuda (local)    │
│ SQLite: conversas, mensagens, decisões,    │      packages/shared
│ rascunhos, sessões                         │      regras do Anexo A em funções puras:
└────────────────────────────────────────────┘      prioridade, prazos, duplicidade
```

- **`packages/shared`**: o Anexo A em código, com testes.
  - Prioridade a partir dos fatos (quem é afetado, se a pessoa está parada, se há compromisso hoje, se há alternativa).
  - Prazos em horário útil de Brasília (crítico conta em tempo corrido, por causa do plantão).
  - Detecção de duplicidade e janela de reabertura de 7 dias.
- **`apps/tickets`**: o serviço de chamados, **separado do agente** e com banco próprio.
  - Quem chama é sempre o servidor do app, com token de serviço, informando em nome de quem age (`x-actor: employee:u-ana`).
  - A regra de privacidade está aqui também: o chamado de outra pessoa responde **404**, sem confirmar que existe.
  - Para simular o "legado que cai por alguns segundos", cada requisição tem uma chance de abrir uma janela de indisponibilidade (`TICKETS_OUTAGE_CHANCE`).
- **`apps/web`**: interface, rotas e agente.
  - O agente roda no servidor; o navegador recebe a resposta em streaming (um evento JSON por linha: passo, texto, cartão, fim).
  - O console e o chat em pausa se atualizam por polling.

## Como o agente decide

Cada mensagem do funcionário gera um **turno**:

1. **Guardas antes do modelo.**
   - Se a conversa está com um analista, ou aguardando um, o agente não responde.
   - Se a sessão chegou a 30 mensagens, a mensagem é recusada.
   - Nenhum dos dois casos gasta tokens.
2. **Decisão obrigatória.** O primeiro passo é forçado (`toolChoice`) a chamar `registrar_decisao`, com:
   - o que entendeu;
   - a intenção (dúvida, consultar, complementar, abrir, falar com analista, fora do escopo…);
   - a ação planejada;
   - a confiança (0 a 1);
   - o motivo e o que falta.
3. **Barreira de confiança.**
   - Abaixo de `NEXO_MIN_CONFIDENCE` (0,6), **o código interrompe o modelo** e transfere a conversa com um resumo.
   - É a regra do Anexo A ("quando o agente não tem segurança") aplicada por código, e não por um pedido educado no prompt.
4. **Ferramentas.** O modelo age só por elas:

   | Ferramenta | O que faz |
   |---|---|
   | `buscar_central_de_ajuda` | Busca local por palavras (8 artigos); custo zero de tokens |
   | `listar_meus_chamados`, `consultar_chamado` | Status e prazo calculados pelo serviço |
   | `preparar_rascunho` | Calcula prioridade e prazo **no código**, verifica duplicidade e só monta o rascunho |
   | `preparar_atualizacao` | Complementar um chamado aberto ou reabrir um resolvido há até 7 dias |
   | `confirmar_rascunho` | Só executa se o rascunho é desta conversa, está pendente e **foi mostrado num turno anterior** |
   | `oferecer_opcoes` | Pergunta com opções rápidas (ex.: quem é afetado) |
   | `transferir_para_analista` | Marca a conversa como aguardando, transfere o chamado na fila certa (N2 para vencidos e críticos) e leva um resumo |

   Pela regra de `confirmar_rascunho`, o modelo não consegue criar um chamado no mesmo turno em que o funcionário ainda nem viu o rascunho.

5. **Registro.** A resposta, os cartões e a decisão (com cada ferramenta, duração, retries, tokens e latência) vão para o banco e aparecem em **ver decisão**, no chat e no console.

**O modelo entende; o código garante as regras.** Ficam fora do alcance do modelo:

- **Prioridade e prazo.** O modelo extrai os fatos; a tabela decide.
- **Confirmação antes de criar.** É uma regra de estado, não de prompt. O botão **Confirmar** do cartão executa direto, sem chamar o modelo (mais rápido e de graça), e mesmo assim registra uma decisão.
- **Privacidade.** As ferramentas são criadas a cada turno com o funcionário da sessão autenticada, e nenhuma aceita "de quem é o chamado" como argumento. O serviço confere de novo.
- **Duplicidade.** O código encontra o candidato; o agente pergunta se é o mesmo problema.
- **Pausa com o analista.** O agente nem é chamado.

### Escolha do modelo

**Gemini Flash** (`NEXO_MODEL`, padrão `gemini-3.8-flash`):

- é rápido e barato, o que importa num chat com 2.000 funcionários ("custo por conversa");
- usa ferramentas bem;
- o raciocínio interno fica desligado (ou no nível baixo nos modelos 3.x), porque o trabalho pesado de regra está no código.

O Mastra deixa trocar de provedor mudando uma linha.

**Custo por conversa:**

- o modelo vê só as últimas 20 mensagens;
- os cartões entram como uma linha de texto, não como JSON;
- o estado que importa (rascunho pendente, chamado em foco) vai num contexto curto, gerado do banco;
- cada decisão mostra os tokens do turno.

## Como garanti a qualidade das decisões

- **Testes das regras** (`packages/shared`): prazos com fim de semana e fora do expediente, matriz de prioridade, duplicidade e janela de reabertura.
- **Testes do serviço de chamados**: token, privacidade (404), validação, reabertura, transferência e a janela de indisponibilidade.
- **Testes de ponta a ponta do turno** (`run-turn.test.ts`).
  - Usam um **modelo roteirizado** (um `LanguageModel` falso que segue um roteiro de chamadas) e o serviço de chamados real em memória.
  - Assim os testes são determinísticos e de graça, mas passam por tudo: Mastra, ferramentas, banco, stream e regras. Eles verificam que:
    - o primeiro passo é sempre a decisão;
    - o modelo não consegue ver chamado de outra pessoa;
    - confiança baixa interrompe e transfere;
    - confirmar no mesmo turno é barrado e no turno seguinte funciona;
    - um problema já aberto não é duplicado;
    - com analista o agente não responde;
    - o limite de 30 mensagens vale;
    - com o legado fora, o agente tenta de novo e avisa, sem inventar resposta.
- **Avaliação com o modelo real** (`pnpm eval`).
  - São 12 cenários do PRD: dúvida resolvida pela central, erro 809 no Windows 10 (resolve) e no 11 (abre chamado), status sem número, chamado vencido, privacidade, RH fora do escopo, pedido de analista, duplicidade, reabertura, complemento e abertura em três turnos.
  - Cada cenário confere intenção, ferramentas usadas ou proibidas e o texto final.
  - É o que eu rodo ao mexer no prompt ou trocar o modelo.

## Segurança e privacidade

- **Chaves**: só no `.env` do servidor (nenhuma variável `NEXT_PUBLIC_`). `.env` está no `.gitignore`.
- **Sessão**: cookie `HttpOnly` e `SameSite=Lax`, assinado com HMAC, e sessão gravada no banco. O servidor nunca confia em um ID vindo do navegador.
- **Privacidade dos chamados**: em duas camadas, nas ferramentas do agente e no serviço de chamados.
- **Abuso e custo**:
  - limite de 30 mensagens por sessão;
  - limite de taxa por funcionário (12 mensagens por minuto);
  - teto de passos e de tokens de saída por turno.

## Principais trade-offs

- **SQLite embutido no Node (`node:sqlite`)**: nada para instalar e persistência real. Para várias instâncias, trocaria por Postgres.
- **Polling no console**, em vez de WebSocket: mais simples e robusto para o escopo. O streaming do agente é de verdade.
- **Busca por palavras na central de ajuda**: com 8 artigos funciona e custa zero. Com centenas, usaria embeddings.
- **Histórico em janela fixa de 20 mensagens**, em vez de resumo: barato e previsível; uma conversa muito longa perde o começo (o estado essencial vai no contexto).
- **Login de demonstração** com qualquer senha, como pede o PRD. Num ambiente real, seria SSO corporativo.

## O que eu faria com mais tempo

- Avaliação contínua: rodar o `pnpm eval` no CI com mais cenários e acompanhar a taxa de acerto e o custo por versão do prompt.
- Notificações em tempo real (SSE) para o console e um alerta quando o prazo de assumir uma conversa estiver perto de vencer.
- Resumo automático das conversas longas, em vez de cortar o histórico.
- Painel de métricas: resolvidos sem fila, transferências por motivo, confiança média e custo por conversa.
- Busca semântica na central de ajuda.
