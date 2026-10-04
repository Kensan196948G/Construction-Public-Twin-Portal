/**
 * MapLibre GL JS の worker を **バンドラ非依存** で用意する。
 *
 * 背景（Next.js 16 + Turbopack + maplibre-gl 6.12 の実測結果）:
 *   maplibre は worker URL を `import.meta.url` を基準に組み立てる
 *   （`new URL("./maplibre-gl-worker.mjs", <chunk URL>)`）。
 *   Turbopack は依存アセットをハッシュ付きファイル名
 *   （`static/media/maplibre-gl-worker.<hash>.mjs`）で逐語コピーするため、
 *   worker 内部の相対 import `./maplibre-gl-shared.mjs` が 404 となり
 *   "Worker failed to load" が発生する。
 *   その結果 map の `load` が発火せず、GeoJSON ソースが一切描画されない。
 *
 * 対策:
 *   worker と shared を **元のファイル名のまま** `public/vendor/maplibre/` に
 *   兄弟として置き、`maplibregl.setWorkerUrl()` でその URL を明示する。
 *   相対 import がそのまま解決するため、Blob への書き換えは不要。
 *   アセットは `npm run vendor:maplibre` で再配置できる
 *   （リポジトリにはコミット済みなので通常は不要）。
 *
 * 実装上の約束:
 *   - バンドラ固有の記法（`?url` / `new URL(..., import.meta.url)`）を使わない。
 *   - 読み込みに失敗しても例外を投げず null を返し、
 *     呼び出し側は maplibre 既定の解決へフォールバックする。
 */

/** 静的配信している worker のパス */
export const MAPLIBRE_WORKER_URL = "/vendor/maplibre/maplibre-gl-worker.mjs";

/** 対応する shared モジュール（worker が相対 import する兄弟ファイル） */
export const MAPLIBRE_SHARED_URL = "/vendor/maplibre/maplibre-gl-shared.mjs";

let cached: Promise<string | null> | null = null;

/**
 * MapLibre 用の worker URL を返す。
 * 配信ファイルが存在しない場合は null（＝ maplibre 既定の解決に任せる）。
 */
export function createMaplibreWorkerUrl(): Promise<string | null> {
  cached ??= probe();
  return cached;
}

async function probe(): Promise<string | null> {
  if (typeof window === "undefined" || typeof fetch !== "function") return null;

  try {
    const [worker, shared] = await Promise.all([
      fetch(MAPLIBRE_WORKER_URL, { method: "HEAD" }),
      fetch(MAPLIBRE_SHARED_URL, { method: "HEAD" }),
    ]);
    if (!worker.ok || !shared.ok) {
      console.warn(
        "[maplibreWorker] worker アセットが見つかりません。maplibre 既定の解決を使用します。",
        { worker: worker.status, shared: shared.status },
      );
      return null;
    }
    return MAPLIBRE_WORKER_URL;
  } catch (error) {
    console.warn("[maplibreWorker] worker アセットを確認できませんでした:", error);
    return null;
  }
}
