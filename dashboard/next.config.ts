import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // API proxy em dev; em produção (static export) o front chama /v1 no mesmo host
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
