import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { createApp } from "./app";
import { Chaos, chaosFromEnv } from "./chaos";
import { TicketRepo } from "./repo";
import { seed } from "./seed";

const port = Number(process.env.TICKETS_PORT ?? 4001);
const token = process.env.TICKETS_SERVICE_TOKEN;
if (!token) {
  console.error("Defina TICKETS_SERVICE_TOKEN (veja .env.example).");
  process.exit(1);
}

const repo = new TicketRepo(resolve(process.env.TICKETS_DB_PATH ?? "../../data/tickets.db"));
if (repo.isEmpty()) {
  seed(repo);
  console.log("[tickets] banco vazio: dados de exemplo criados");
}

const app = createApp({ repo, chaos: new Chaos(chaosFromEnv(process.env)), serviceToken: token });
const server = serve({ fetch: app.fetch, port, hostname: process.env.TICKETS_HOST ?? "127.0.0.1" }, (info) =>
  console.log(`[tickets] ouvindo em http://${info.address}:${info.port}`),
);

const shutdown = () => {
  server.close();
  repo.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
