import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/",
      headers: [{
        key: "Cache-Control",
        value: "no-store, no-cache, must-revalidate, max-age=0",
      }],
    }];
  },
};

export default nextConfig;
