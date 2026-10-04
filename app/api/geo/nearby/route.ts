/**
 * GET /api/geo/nearby
 *
 * 地図クリック地点・住所検索結果の周辺にある施工中現場を距離順に返す。
 * 仕様書の「住所の座標から500m以内の施工中現場」を PostGIS の ST_DWithin で実装する。
 *
 *   Query: lng lat radius limit
 *   応答:  { origin, radiusM, count, source, sourceLabel, notice?, projects[] }
 */
import { queryNearby } from "@/lib/db/queries";
import { staticNearby } from "@/lib/data/ledger";
import { DB_SOURCE_LABEL } from "@/lib/db/client";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/lib/schemas/project";
import { badRequest, ok, queryObject, zodErrorMessage } from "@/app/api/_lib/http";
import { nearbyQuerySchema } from "@/app/api/_lib/schemas";

export const dynamic = "force-dynamic";

const DEFAULT_RADIUS_M = 500;
const DEFAULT_LIMIT = 20;
const MAX_RADIUS_M = 50_000;

interface NearbyItem {
  projectId: string;
  officialName: string;
  publicTitle: string;
  category: string;
  status: string;
  statusLabel: string;
  municipality: string;
  address: string;
  distanceM: number;
  insideWorkZone: boolean;
}

function statusLabelOf(status: string): string {
  return PROJECT_STATUS_LABEL[status as ProjectStatus] ?? status;
}

export async function GET(request: Request): Promise<Response> {
  const parsed = nearbyQuerySchema.safeParse(queryObject(request));
  if (!parsed.success) {
    return badRequest(`クエリが不正です: ${zodErrorMessage(parsed.error)}`);
  }

  const { lng, lat } = parsed.data;
  const radiusM = Math.min(parsed.data.radius ?? DEFAULT_RADIUS_M, MAX_RADIUS_M);
  const limit = parsed.data.limit ?? DEFAULT_LIMIT;

  const dbResult = await queryNearby(lng, lat, radiusM, limit);

  let projects: NearbyItem[];
  if (dbResult.ok) {
    projects = dbResult.data.map((row) => ({
      projectId: row.project_id,
      officialName: row.official_name,
      publicTitle: row.public_title,
      category: row.category,
      status: row.status,
      statusLabel: statusLabelOf(row.status),
      municipality: row.municipality,
      address: row.address,
      distanceM: Math.round(Number(row.distance_m) * 10) / 10,
      insideWorkZone: Boolean(row.inside_work_zone),
    }));
  } else {
    projects = staticNearby(lng, lat, radiusM, limit).map((row) => ({
      projectId: row.projectId,
      officialName: row.officialName,
      publicTitle: row.publicTitle,
      category: row.category,
      status: row.status,
      statusLabel: statusLabelOf(row.status),
      municipality: row.municipality,
      address: row.address,
      distanceM: Math.round(row.distanceM * 10) / 10,
      insideWorkZone: row.insideWorkZone,
    }));
  }

  return ok({
    origin: { longitude: lng, latitude: lat },
    radiusM,
    count: projects.length,
    source: dbResult.ok ? "postgis" : "static",
    sourceLabel: dbResult.ok ? DB_SOURCE_LABEL : "静的データ（public/data）",
    notice: dbResult.ok ? undefined : dbResult.message,
    projects,
  });
}
