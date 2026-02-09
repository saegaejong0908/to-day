import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  async headers() {
    return [
      {
        source: "/:path((?!_next/|.*\\..*).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, max-age=0",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
