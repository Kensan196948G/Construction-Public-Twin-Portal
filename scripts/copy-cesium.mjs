#!/usr/bin/env node
/**
 * CesiumJS の静的アセットを public/cesium へコピーする。
 *
 *   node scripts/copy-cesium.mjs
 *
 * なぜ必要か:
 *   CesiumJS は実行時に Workers / Assets / Widgets / ThirdParty を
 *   `CESIUM_BASE_URL` 配下から取得する。Next.js 16 は Turbopack が既定で、
 *   webpack プラグイン（copy-webpack-plugin / DefinePlugin）が使えないため、
 *   バンドラ設定ではなくスクリプトで public 配下へ複製する。
 *
 *   public/cesium → URL `/cesium`（`window.CESIUM_BASE_URL = "/cesium"`）
 *
 * 冪等: 既に最新（マーカーのバージョンが一致）なら何もしない。
 * 依存ゼロ: 追加パッケージを使わず node:fs だけで実装する。
 */
import { cp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(PROJECT_DIR, "node_modules", "cesium", "Build", "Cesium");
const TARGET = join(PROJECT_DIR, "public", "cesium");
const MARKER = join(TARGET, ".version");

/** cesium パッケージのバージョンを得る */
async function cesiumVersion() {
  const pkg = JSON.parse(
    await readFile(join(PROJECT_DIR, "node_modules", "cesium", "package.json"), "utf8"),
  );
  return pkg.version;
}

async function main() {
  if (!existsSync(SOURCE)) {
    console.warn(
      "[copy:cesium] node_modules/cesium/Build/Cesium が見つかりません。スキップします。" +
        "（npm install 後に再実行してください）",
    );
    return;
  }

  const version = await cesiumVersion();
  if (existsSync(MARKER)) {
    const current = (await readFile(MARKER, "utf8")).trim();
    if (current === version) {
      console.log(`[copy:cesium] 最新です (cesium@${version})。コピーを省略します。`);
      return;
    }
  }

  await rm(TARGET, { recursive: true, force: true });
  await mkdir(TARGET, { recursive: true });

  // Build/Cesium 配下（Workers / Assets / Widgets / ThirdParty）を複製する。
  // SourceMap は不要なので除外する。
  await cp(SOURCE, TARGET, {
    recursive: true,
    filter: (src) => !src.endsWith(".map"),
  });

  // Widgets の CSS は Cesium のパッケージ外（Build/CesiumUnminified）にある場合がある
  const altCss = join(
    PROJECT_DIR,
    "node_modules",
    "cesium",
    "Build",
    "CesiumUnminified",
    "Widgets",
    "widgets.css",
  );
  const targetCss = join(TARGET, "Widgets", "widgets.css");
  try {
    await access(targetCss);
  } catch {
    if (existsSync(altCss)) {
      await mkdir(dirname(targetCss), { recursive: true });
      await cp(altCss, targetCss);
      console.log("[copy:cesium] widgets.css を CesiumUnminified から補完しました。");
    } else {
      console.warn("[copy:cesium] widgets.css が見つかりません。");
    }
  }

  await writeFile(MARKER, `${version}\n`, "utf8");
  console.log(`[copy:cesium] public/cesium へ複製しました (cesium@${version})。`);
}

main().catch((error) => {
  // ビルドを止めない: Cesium は「あれば使う」扱いのため、失敗しても警告に留める。
  console.warn("[copy:cesium] 失敗:", error instanceof Error ? error.message : error);
});
