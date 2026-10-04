import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // MVP: sample photographs are served from /public/images. Keep the repo self-contained.
  //
  // NOTE: Next.js 16 removed the `eslint` config key (`next lint` is gone).
  // Lint and typecheck are run explicitly by the verification loop via
  // `npm run lint` / `npm run typecheck`.
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
