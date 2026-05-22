import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/", destination: "/workbench.html" },
      { source: "/about", destination: "/about.html" },
    ];
  },
};

export default nextConfig;
