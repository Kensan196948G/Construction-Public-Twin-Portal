import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 自動テスト設定（apidata 担当）。
 *
 * - environment: node … Route Handler をサーバー起動なしで直接 import して検証する。
 * - include: tests/**\/*.test.ts … テスト本体のみ。tests/fixtures/** は対象外。
 * - alias @ → リポジトリルート（tsconfig.json の paths と同じ解決）。
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
