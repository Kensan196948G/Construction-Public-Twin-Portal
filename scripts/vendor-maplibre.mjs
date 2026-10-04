#!/usr/bin/env node
/**
 * MapLibre GL JS の worker アセットを `public/vendor/maplibre/` へ配置する。
 *
 * なぜ必要か（Next.js 16 + Turbopack + maplibre-gl 6 の実測結果）:
 *   maplibre の worker URL 決定関数は `import.meta.url` を基準に
 *   `new URL("./maplibre-gl-worker.mjs", <chunk URL>)` を組み立てる。
 *   Turbopack は依存アセットを `static/media/<name>.<hash>.mjs` として
 *   **ハッシュ付きファイル名で逐語コピー**するため、
 *   worker 内部の相対 import `./maplibre-gl-shared.mjs` が解決できず
 *   "Worker failed to load" となり GeoJSON ソースが一切描画されない。
 *
 * 解決:
 *   worker と shared を **元のファイル名のまま** 兄弟として静的配信する。
 *   こうすると worker 内の相対 import がそのまま解決するため、
 *   Blob への書き換えなどの小細工が一切不要になる。
 *
 *   maplibregl.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs")
 *
 * 生成物はリポジトリにコミット済みだが、maplibre-gl を更新した際は
 *   npm run vendor:maplibre
 * を再実行すること。
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "node_modules", "maplibre-gl", "dist");
const DEST_DIR = join(ROOT, "public", "vendor", "maplibre");

/**
 * 本番ビルド版のみを配る。
 * dev 版は開発時の警告が詳細になるだけで機能差がないため、
 * 配布物とファイル数を抑える目的で本番版に統一する。
 */
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

async function main() {
  await mkdir(DEST_DIR, { recursive: true });

  for (const file of FILES) {
    const from = join(SRC_DIR, file);
    try {
      await stat(from);
    } catch {
      throw new Error(
        `maplibre-gl の dist に ${file} が見つかりません。maplibre-gl のバージョンを確認してください: ${from}`,
      );
    }
    await copyFile(from, join(DEST_DIR, file));
  }

  // 参照されない開発版が混ざっていれば掃除する
  console.log(`[vendor:maplibre] ${FILES.length} ファイルを public/vendor/maplibre/ へ配置しました。`);
}

main().catch((error) => {
  console.error("[vendor:maplibre] 失敗:", error?.message ?? error);
  process.exit(1);
});
