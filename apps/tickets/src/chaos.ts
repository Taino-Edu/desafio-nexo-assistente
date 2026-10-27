// O PRD avisa que o sistema de chamados é legado e "de vez em quando fica
// indisponível por alguns segundos". Este módulo reproduz isso de propósito:
// cada requisição tem uma pequena chance de iniciar uma janela de indisponibilidade,
// e durante a janela tudo responde 503. Assim o tratamento de falha do agent é
// exercitado de verdade, não só em teste.

export type ChaosConfig = {
  outageChance: number;
  outageMs: number;
  latencyMs: [number, number];
};

export class Chaos {
  private outageUntil = 0;

  constructor(
    private config: ChaosConfig,
    private random: () => number = Math.random,
    private clock: () => number = Date.now,
  ) {}

  /** Devolve true se esta requisição deve falhar. */
  shouldFail(): boolean {
    const now = this.clock();
    if (now < this.outageUntil) return true;
    if (this.random() < this.config.outageChance) {
      this.outageUntil = now + this.config.outageMs;
      return true;
    }
    return false;
  }

  latency(): number {
    const [min, max] = this.config.latencyMs;
    return Math.round(min + this.random() * (max - min));
  }

  /** Força uma indisponibilidade (usado pelo endpoint de demonstração). */
  forceOutage(ms: number): void {
    this.outageUntil = this.clock() + ms;
  }
}

export function chaosFromEnv(env: NodeJS.ProcessEnv): ChaosConfig {
  return {
    outageChance: Number(env.TICKETS_OUTAGE_CHANCE ?? 0.03),
    outageMs: Number(env.TICKETS_OUTAGE_MS ?? 4000),
    latencyMs: [Number(env.TICKETS_LATENCY_MIN_MS ?? 60), Number(env.TICKETS_LATENCY_MAX_MS ?? 250)],
  };
}
