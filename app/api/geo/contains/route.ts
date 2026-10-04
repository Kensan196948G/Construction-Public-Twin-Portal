/**
 * GET /api/geo/contains
 *
 * 指定地点がどの施工範囲（工区 Polygon / 規制・迂回路 LineString）に入るかを返す。
 * 「地図クリック位置がどの現場の工区に入るか」を PostGIS の ST_Intersects で判定する。
 *
 *   Query: lng lat kinds(カンマ区切り) limit
 *   応答:  { point, count, source, sourceLabel, notice?, features[] }
 */
import { queryContaining } from "@/lib/db/queries";
import { staticContaining } from "@/lib/data/ledger";
import { DB_SOURCE_LABEL } from "@/lib/db/client";
import { geometryKindLabel, type GeometryKind } from "@/lib/data/geometry";
import { badRequest, ok, queryObject, zodErrorMessage } from "@/app/api/_lib/http";
import { containsQuerySchema } from "@/app/api/_lib/schemas";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const ALLOWED_KINDS: GeometryKind[] = ["workzone", "regulation", "detour", "pedestrian"];

interface ContainingItem {
  featureId: string;
  projectId: string;
  featureKind: string;
  featureKindLabel: string;
  name: string;
  geometryType: string;
  distanceM: number;
}

function parseKinds(raw: string | undefined): GeometryKind[] | null {
  if (!raw) return null;
  const parsed = raw
    .split(",")
    .map((k) => k.trim())
    .filter((k): k is GeometryKind => (ALLOWED_KINDS as string[]).includes(k));
  return parsed.length > 0 ? parsed : null;
}

export async function GET(request: Request): Promise<Response> {
  const parsed = containsQuerySchema.safeParse(queryObject(request));
  if (!parsed.success) {
    return badRequest(`クエリが不正です: ${zodErrorMessage(parsed.error)}`);
  }

  const { lng, lat } = parsed.data;
  const kinds = parseKinds(parsed.data.kinds);
  const limit = parsed.data.limit ?? DEFAULT_LIMIT;

  const dbResult = await queryContaining(lng, lat, kinds, limit);

  let features: ContainingItem[];
  if (dbResult.ok) {
    features = dbResult.data.map((row) => ({
      featureId: row.feature_id,
      projectId: row.project_id,
      featureKind: row.feature_kind,
      featureKindLabel: labelOfKind(row.feature_kind),
      name: row.name,
      geometryType: row.geometry_type,
      distanceM: Math.round(Number(row.distance_m) * 10) / 10,
    }));
  } else {
    features = staticContaining(lng, lat, kinds, limit).map((row) => ({
      featureId: row.featureId,
      projectId: row.projectId,
      featureKind: row.featureKind,
      featureKindLabel: labelOfKind(row.featureKind),
      name: row.name,
      geometryType: row.geometryType,
      distanceM: Math.round(row.distanceM * 10) / 10,
    }));
  }

  return ok({
    point: { longitude: lng, latitude: lat },
    count: features.length,
    source: dbResult.ok ? "postgis" : "static",
    sourceLabel: dbResult.ok ? DB_SOURCE_LABEL : "静的データ（public/data）",
    notice: dbResult.ok ? undefined : dbResult.message,
    features,
  });
}

function labelOfKind(kind: string): string {
  return (ALLOWED_KINDS as string[]).includes(kind)
    ? geometryKindLabel(kind as GeometryKind)
    : kind;
}
