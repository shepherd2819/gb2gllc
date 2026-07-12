import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "host", value: "home.gb2gllc.com" }],
        destination: "/dashboard",
        permanent: false,
      },
      {
        source: "/",
        has: [{ type: "host", value: "admin.gb2gllc.com" }],
        destination: "/admin",
        permanent: false,
      },
      {
        source: "/hollis-demo.html",
        destination: "/hollis",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/", destination: "/workbench.html" },
      { source: "/about", destination: "/about.html" },
      { source: "/hollis", destination: "/hollis.html" },
    ];
  },
  experimental: {
    viewTransition: true,
  },
};

export default nextConfig;
