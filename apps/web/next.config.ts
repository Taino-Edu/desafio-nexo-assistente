import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@nexo/shared"],
  poweredByHeader: false,
  agentRules: false,
};

export default config;
