import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // "server-only" só faz sentido dentro do Next; nos testes vira um módulo vazio.
      "server-only": here("./test/server-only.ts"),
      "@": here("./apps/web/src"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    environment: "node",
    env: {
      SESSION_SECRET: "segredo-de-teste-com-mais-de-16",
      TICKETS_SERVICE_TOKEN: "token-de-teste",
      TICKETS_URL: "http://tickets.test",
      NEXO_MIN_CONFIDENCE: "0.6",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
    },
  },
});
