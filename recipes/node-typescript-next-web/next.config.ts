import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: import.meta.dirname,
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: { root: import.meta.dirname },
};

export default config;
