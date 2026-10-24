import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // @factory/shared is TypeScript source in this monorepo.
  transpilePackages: ["@factory/shared"],
  webpack(cfg) {
    // shared imports its own files as "./x.js" (NodeNext style); resolve them to .ts.
    // Turbopack has no equivalent, so the scripts run Next with --webpack.
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return cfg;
  },
};

export default config;
