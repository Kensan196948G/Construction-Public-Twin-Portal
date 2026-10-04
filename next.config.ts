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
  /**
   * 開発サーバを 127.0.0.1 で開くと Next 16 が dev リソースを cross-origin として
   * ブロックし、hydration が止まる（HMR が ERR_INVALID_HTTP_RESPONSE になる）。
   * 検証ハーネス（headless Chrome）から安定して触れるよう明示的に許可する。
   */
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.0.185"],
};

export default nextConfig;
