/**
 * GET /api/health
 *
 * MVP 環境の構成状態を 1 か所で確認するためのエンドポイント。
 * 「実際に使えるのか」を正直に返す（使えないものを「使用中」と表示しない）。
 *
 *   Query: probe=1 … ジオコーダーへの到達確認も行う（既定は行わない）
 *
 *   応答: { status, database, geocoder, viewer, data }
 */
import { dbHealth } from "@/lib/db/client";
import { geocodeAddress, GSI_GEOCODER_SOURCE } from "@/lib/geo/gsi";
import { publicImpacts } from "@/lib/data/impacts";
import { publicProjects } from "@/lib/data/projects";
import { buildAllCollection } from "@/lib/data/geometry";
import { ok } from "@/app/api/_lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const probe = new URL(request.url).searchParams.get("probe") === "1";

  const database = await dbHealth();

  const geocoder: {
    configured: true;
    reachable: boolean | null;
    source: typeof GSI_GEOCODER_SOURCE;
    probeQuery?: string;
    probeResultCount?: number;
    error?: string;
  } = {
    configured: true,
    reachable: probe ? false : null,
    source: GSI_GEOCODER_SOURCE,
  };
  if (probe) {
    const probeQuery = "東京都千代田区丸の内一丁目9番1号";
    const outcome = await geocodeAddress(probeQuery, 1);
    geocoder.probeQuery = probeQuery;
    geocoder.reachable = outcome.count > 0;
    geocoder.probeResultCount = outcome.count;
    if (outcome.error) geocoder.error = outcome.error;
  }

  const projects = publicProjects();
  const impacts = publicImpacts();
  const features = buildAllCollection(["workzone", "regulation", "detour", "pedestrian"]);

  const cesiumIonToken = Boolean(process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN);
  const plateauTilesetUrl = process.env.NEXT_PUBLIC_PLATEAU_TILESET_URL ?? "";

  const items = [
    { id: "database", ok: database.reachable },
    { id: "staticData", ok: projects.length > 0 },
    { id: "viewer", ok: true },
    { id: "geocoder", ok: probe ? geocoder.reachable === true : true },
  ];
  const degraded = items.filter((i) => !i.ok).map((i) => i.id);

  return ok({
    status: degraded.length === 0 ? "ok" : "degraded",
    degraded,
    database,
    geocoder,
    viewer: {
      /** CesiumJS の静的アセットを public/cesium へ複製済みか */
      cesiumAssetsCopied: true,
      /** ion トークンが設定されているか（未設定でもトークン不要の背景で動作する） */
      cesiumIonTokenConfigured: cesiumIonToken,
      /** 明示指定された PLATEAU 3D Tiles */
      plateauTilesetConfigured: plateauTilesetUrl.length > 0,
      /** トークン不要の既定背景 */
      tokenFreeBase: {
        imagery: "地理院タイル（標準地図 / 空中写真）",
        terrain: "PLATEAU-Terrain（tile.plateauview.mlit.go.jp）",
      },
    },
    data: {
      projects: projects.length,
      impacts: impacts.length,
      geoJsonFeatures: features.features.length,
      geoJsonKinds: ["workzone", "regulation", "detour", "pedestrian"],
    },
  });
}
