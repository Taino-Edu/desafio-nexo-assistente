// Apaga os bancos locais. Os dados de exemplo são recriados no próximo start.
import { rmSync, existsSync } from "node:fs";

if (existsSync("data")) {
  rmSync("data", { recursive: true, force: true });
  console.log("Pasta data/ apagada. Rode `pnpm dev` para recriar os dados de exemplo.");
} else {
  console.log("Nada para apagar.");
}
