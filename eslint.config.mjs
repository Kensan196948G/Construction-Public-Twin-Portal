import next from "eslint-config-next";

/**
 * Flat ESLint config.
 * `WebUI/` holds the exported design reference and is not part of the build.
 *
 * NOTE: `.next.bak*` はデプロイ時に作るビルド成果物の退避コピー。
 *       生成物を lint すると大量の誤検知が出るため必ず除外する。
 */
const config = [
  {
    ignores: [
      ".next/**",
      ".next.bak/**",
      ".next.bak*/**",
      "node_modules/**",
      "WebUI/**",
      "public/**",
      "next-env.d.ts",
      "scripts/**",
    ],
  },
  ...next,
];

export default config;
