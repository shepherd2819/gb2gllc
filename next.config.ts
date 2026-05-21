import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/", destination: "/workbench.html" },
    ];
  },
};

export default nextConfig;
