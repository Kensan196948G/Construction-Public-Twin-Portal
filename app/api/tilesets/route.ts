/**
 * GET /api/tilesets
 *
 * 契約: docs/CONTRACTS.md §3.2
 *   { defaultSource: "local", tilesets: TilesetConfig[] }
 *
 * MVP の既定背景はローカル（手続き生成）で、PLATEAU は
 * NEXT_PUBLIC_PLATEAU_TILESET_URL が供給されたときのみ `configured: true` になる。
 * 外部タイルが無くても 3D は必ず表示できる、という設計をこの応答で開示する。
 */
import { TILESETS } from "@/lib/viewer/tileConfig";
import { ok } from "@/app/api/_lib/http";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return ok({
    defaultSource: "local" as const,
    tilesets: TILESETS,
  });
}
