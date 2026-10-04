/**
 * GeoJSON の型・生成・検証。
 *
 * 仕様書 #7 GeoJSON 表示仕様に対応。
 * 対応 Geometry: Point / LineString / MultiLineString / Polygon / MultiPolygon
 */
import { z } from "zod";
import { sceneToLngLat } from "./transform";

/* ------------------------------------------------------------------ *
 * 型
 * ------------------------------------------------------------------ */

export const positionSchema = z.tuple([z.number(), z.number()]).rest(z.number());

export const geoJsonGeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: positionSchema }),
  z.object({ type: z.literal("LineString"), coordinates: z.array(positionSchema).min(2) }),
  z.object({
    type: z.literal("MultiLineString"),
    coordinates: z.array(z.array(positionSchema).min(2)).min(1),
  }),
  z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(positionSchema).min(4)).min(1) }),
  z.object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(z.array(z.array(positionSchema).min(4)).min(1)).min(1),
  }),
]);

export type GeoJsonGeometry = z.infer<typeof geoJsonGeometrySchema>;

/** 仕様書 #7: Feature は最低限これらの属性を保持可能とする */
export const featurePropertiesSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  type: z.string(),
  name: z.string(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  source: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type FeatureProperties = z.infer<typeof featurePropertiesSchema>;

export const featureSchema = z.object({
  type: z.literal("Feature"),
  id: z.string().optional(),
  geometry: geoJsonGeometrySchema,
  properties: featurePropertiesSchema,
});

export type GeoJsonFeature = z.infer<typeof featureSchema>;

export const featureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(featureSchema),
});

export type FeatureCollection = z.infer<typeof featureCollectionSchema>;

/* ------------------------------------------------------------------ *
 * 生成
 * ------------------------------------------------------------------ */

/**
 * ローカル座標（基準点からのメートル、z は南が正）の配列から
 * WGS84 の座標列を生成する。
 */
export function localRingToLngLat(ring: [number, number][]): [number, number][] {
  return ring.map(([x, z]) => {
    const { longitude, latitude } = sceneToLngLat(x, z);
    return [longitude, latitude] as [number, number];
  });
}

/** ローカル座標の線分列から LineString を生成 */
export function localLineToLngLat(line: [number, number][]): [number, number][] {
  return localRingToLngLat(line);
}

/* ------------------------------------------------------------------ *
 * 検証・ユーティリティ
 * ------------------------------------------------------------------ */

/** GeoJSON として妥当かを検証し、エラーメッセージ配列を返す（空配列 = OK） */
export function validateFeatureCollection(input: unknown): string[] {
  const result = featureCollectionSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

/** すべての座標を列挙する */
export function eachPosition(
  geometry: GeoJsonGeometry,
  visit: (position: number[]) => void,
): void {
  switch (geometry.type) {
    case "Point":
      visit(geometry.coordinates);
      break;
    case "LineString":
      geometry.coordinates.forEach(visit);
      break;
    case "MultiLineString":
      geometry.coordinates.forEach((l) => l.forEach(visit));
      break;
    case "Polygon":
      geometry.coordinates.forEach((r) => r.forEach(visit));
      break;
    case "MultiPolygon":
      geometry.coordinates.forEach((p) => p.forEach((r) => r.forEach(visit)));
      break;
  }
}

/** FeatureCollection の外接矩形 [minLon, minLat, maxLon, maxLat] */
export function collectionBounds(
  collection: FeatureCollection,
): [number, number, number, number] | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  let seen = false;

  for (const feature of collection.features) {
    eachPosition(feature.geometry, ([lon, lat]) => {
      seen = true;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    });
  }

  return seen ? [minLon, minLat, maxLon, maxLat] : null;
}

export function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
