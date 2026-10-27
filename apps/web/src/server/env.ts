import "server-only";
import { z } from "zod";

// Configuração validada uma vez. Chaves ficam só no servidor: nada aqui é
// prefixado com NEXT_PUBLIC_, então não vai para o navegador.

const schema = z.object({
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().default(""),
  NEXO_MODEL: z.string().default("gemini-2.5-flash"),
  NEXO_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET precisa de pelo menos 16 caracteres"),
  WEB_DB_PATH: z.string().default("../../data/web.db"),
  TICKETS_URL: z.string().url().default("http://127.0.0.1:4001"),
  TICKETS_SERVICE_TOKEN: z.string().min(1, "Defina TICKETS_SERVICE_TOKEN"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}
