import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";

// Um único .env na raiz serve aos dois apps.
loadEnvConfig(resolve(process.cwd(), "../.."));

const config: NextConfig = {
  transpilePackages: ["@nexo/shared"],
  poweredByHeader: false,
};

export default config;
