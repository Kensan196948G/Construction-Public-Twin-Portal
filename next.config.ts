import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // MVP: sample photographs are served from /public/images. Keep the repo self-contained.
  eslint: {
    // `npm run lint` is executed explicitly in the verification loop.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // `npm run typecheck` is executed explicitly in the verification loop.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
