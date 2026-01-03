import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.NODE_ENV === "development"
    ? ({ devIndicators: false } as unknown as NextConfig)
    : {}),
};

export default nextConfig;
