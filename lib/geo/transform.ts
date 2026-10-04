/**
 * WGS84 ⇄ シーンローカル座標の変換。
 *
 * 仕様書 #6 座標仕様:
 *   WGS84 / PLATEAU → 対象地区の基準点 → ローカル座標変換 → Three.js Scene
 *
 * 基本方向: X = 東西(+が東), Y = 高さ, Z = 南北(+が南)
 *
 * UI コンポーネントから分離しておき、将来 CesiumJS 等へ差し替えられるようにする。
 */

/** 対象地区の基準点（田園調布駅周辺）。プロトタイプの ORIGIN と同一。 */
export const SCENE_ORIGIN = {
  longitude: 139.668,
  latitude: 35.593,
} as const;

/** 基準緯度における 1 度あたりのメートル数 */
const METERS_PER_DEG_LAT = 110540;

function metersPerDegLon(latitude: number): number {
  return 111320 * Math.cos((latitude * Math.PI) / 180);
}

export interface ScenePoint {
  x: number;
  y: number;
  z: number;
}

/**
 * 経緯度 → シーンローカル座標 (メートル)。
 * 高さ y は 0 を基準とし、任意で elevation を渡せる。
 */
export function lngLatToScene(
  longitude: number,
  latitude: number,
  elevation = 0,
): ScenePoint {
  const mLon = metersPerDegLon(SCENE_ORIGIN.latitude);
  return {
    x: (longitude - SCENE_ORIGIN.longitude) * mLon,
    y: elevation,
    z: -(latitude - SCENE_ORIGIN.latitude) * METERS_PER_DEG_LAT,
  };
}

/** シーンローカル座標 → 経緯度。逆変換。 */
export function sceneToLngLat(x: number, z: number): { longitude: number; latitude: number } {
  const mLon = metersPerDegLon(SCENE_ORIGIN.latitude);
  return {
    longitude: SCENE_ORIGIN.longitude + x / mLon,
    latitude: SCENE_ORIGIN.latitude - z / METERS_PER_DEG_LAT,
  };
}

/**
 * プロトタイプの座標系（基準点からのメートル、z は南が正）を
 * そのままシーン座標として使うためのエイリアス。
 */
export function localToScene(local: [number, number], elevation = 0): ScenePoint {
  return { x: local[0], y: elevation, z: local[1] };
}

/** 経緯度の配列をシーン座標の配列へ */
export function ringToScene(ring: number[][], elevation = 0): ScenePoint[] {
  return ring.map(([lon, lat]) => lngLatToScene(lon, lat, elevation));
}

/** メートルを度へ（おおよそ）。GeoJSON 生成時のバッファ計算などに使用。 */
export function metersToDegrees(meters: number, atLatitude = SCENE_ORIGIN.latitude) {
  return {
    longitude: meters / metersPerDegLon(atLatitude),
    latitude: meters / METERS_PER_DEG_LAT,
  };
}
