import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {},
  webpack(config) {
    config.resolve.modules = [
      path.resolve(__dirname, "node_modules"),
      ...config.resolve.modules,
    ];
    return config;
  },
};

export default nextConfig;
