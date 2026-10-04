/**
 * 依存を増やさないための最小の地理演算。
 *
 * PostGIS（サーバー側）が使えない環境でも空間検索を成立させるための
 * フォールバック実装であり、PostGIS がある場合はそちらを優先する。
 * 球面近似（haversine）とレイキャスティングのみを提供する。
 */

const EARTH_RADIUS_M = 6_371_008.8;

/** 2点間の距離（メートル、球面近似） */
export function distanceMeters(
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type Position = readonly [number, number];
/** Zod の tuple().rest() 由来の座標は長さ可変なので、受け側は緩く受ける */
export type PositionLike = readonly number[];

/** 点がリング内にあるか（レイキャスティング法） */
function pointInRing(lng: number, lat: number, ring: readonly PositionLike[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * 点が Polygon / MultiPolygon の内側にあるか。
 * 穴（interior ring）は考慮する（外環内 かつ どの穴の内側でもない）。
 */
export function pointInPolygon(
  lng: number,
  lat: number,
  geometry:
    | { type: "Polygon"; coordinates: readonly (readonly PositionLike[])[] }
    | { type: "MultiPolygon"; coordinates: readonly (readonly (readonly PositionLike[])[])[] },
): boolean {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const rings of polygons) {
    if (rings.length === 0) continue;
    if (!pointInRing(lng, lat, rings[0])) continue;
    const inHole = rings.slice(1).some((hole) => pointInRing(lng, lat, hole));
    if (!inHole) return true;
  }
  return false;
}

/** 点と線分の最短距離（メートル、局所平面近似） */
export function distanceToLineString(
  lng: number,
  lat: number,
  coordinates: readonly PositionLike[],
): number {
  if (coordinates.length === 0) return Number.POSITIVE_INFINITY;
  if (coordinates.length === 1) {
    return distanceMeters(lng, lat, coordinates[0][0], coordinates[0][1]);
  }

  const metersPerDegLat = 110_574;
  const metersPerDegLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  const px = 0;
  const py = 0;

  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const ax = (coordinates[i][0] - lng) * metersPerDegLng;
    const ay = (coordinates[i][1] - lat) * metersPerDegLat;
    const bx = (coordinates[i + 1][0] - lng) * metersPerDegLng;
    const by = (coordinates[i + 1][1] - lat) * metersPerDegLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    best = Math.min(best, Math.hypot(cx - px, cy - py));
  }
  return best;
}
