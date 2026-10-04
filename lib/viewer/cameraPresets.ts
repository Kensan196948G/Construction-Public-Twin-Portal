/**
 * 3D ビューアのカメラプリセット。
 *
 * 出典: WebUI/koji-mieru-map-3d.html の Orbit 実装。
 * カメラ位置は注視点を中心とした球面座標で表す:
 *
 *   x = target.x + r * sin(phi) * sin(theta)
 *   y = target.y + r * cos(phi)
 *   z = target.z + r * sin(phi) * cos(theta)
 *
 * theta = 方位角 (rad), phi = 天頂角 (rad, 0 = 真上 / PI/2 = 水平)。
 *
 * 距離・ピッチの制約は `lib/viewer/tileConfig.ts` の VIEWER_LIMITS を唯一の出典とし、
 * ここで独自の数値を増やさない。
 */
import { getProjectById } from "@/lib/data/projects";
import { buildSiteModelData } from "@/lib/site/sceneData";
import { VIEWER_LIMITS } from "@/lib/viewer/tileConfig";
import { siteRadius, structureHeight } from "@/lib/viewer/siteScene";

/** three.js の Vector3 と構造的に互換な最小の型（lib 側で three に依存しないため） */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type CameraPresetId = "overview" | "top" | "front";

export interface CameraPreset {
  id: CameraPresetId;
  /** ボタン表示名（日本語 UI） */
  label: string;
  /** 注視点からの距離 (m) */
  distance: number;
  /** 方位角 (rad) */
  theta: number;
  /** 天頂角 (rad)。0 = 真上、PI/2 = 水平 */
  phi: number;
  /** 補足説明（title 属性用） */
  description: string;
}

const DEG = Math.PI / 180;

/**
 * ピッチ制約から許容する天頂角の範囲を導出する。
 * pitch = 水平からの仰角なので、phi = 90deg - pitch。
 * 端で跳ねないよう僅かなマージンを取る（プロトタイプの 0.16〜1.45 とほぼ一致）。
 */
export const PHI_MIN = Math.max(0.12, (90 - VIEWER_LIMITS.maxPitchDeg) * DEG);
export const PHI_MAX = Math.min(1.46, (90 - VIEWER_LIMITS.minPitchDeg) * DEG);

/** 既定の注視点（基準点の直上 8m。プロトタイプと同じ） */
export const DEFAULT_CAMERA_TARGET: Vec3Like = { x: 0, y: 8, z: 0 };

/** プリセット。distance は VIEWER_LIMITS の範囲内に収めてある。 */
export const CAMERA_PRESETS: readonly CameraPreset[] = [
  {
    id: "overview",
    label: "標準",
    distance: 620,
    theta: -0.72,
    phi: 0.85,
    description: "地区全体を見渡す斜めからの視点",
  },
  {
    id: "top",
    label: "俯瞰",
    distance: 760,
    theta: 0,
    phi: 0.2,
    description: "真上から工区と道路の位置関係を見る",
  },
  {
    id: "front",
    label: "正面",
    distance: 440,
    theta: -Math.PI / 2,
    phi: 1.18,
    description: "西側から水平に近い高さで見る",
  },
];

export function presetById(id: CameraPresetId): CameraPreset {
  const found = CAMERA_PRESETS.find((p) => p.id === id);
  // CAMERA_PRESETS は網羅しているため実際には到達しない。
  // 型を締めるためのフォールバック。
  return found ?? CAMERA_PRESETS[0];
}

/** 距離をビューア制約の範囲へ丸める */
export function clampDistance(distance: number): number {
  return Math.min(VIEWER_LIMITS.maxDistanceM, Math.max(VIEWER_LIMITS.minDistanceM, distance));
}

/** 天頂角をビューア制約の範囲へ丸める */
export function clampPhi(phi: number): number {
  return Math.min(PHI_MAX, Math.max(PHI_MIN, phi));
}

/**
 * 工区へフォーカスするときの距離。
 * 工区半径が大きい場合は少し引いて全体が入るようにする。
 *
 * `minDistanceM` を渡すと下限を引き上げられる（現場3Dは至近距離から見るため、
 * 地区全体と同じ 260m では遠すぎる）。
 */
export function focusDistanceFor(
  radiusM: number,
  minDistanceM: number = VIEWER_LIMITS.focusDistanceM,
): number {
  const base = Math.max(minDistanceM, radiusM * 3.2);
  return clampDistance(base);
}

/** 球面座標からカメラ位置を求める（three.js の Vector3 互換タプル） */
export function cameraPositionFor(
  target: Vec3Like,
  orbit: { distance: number; theta: number; phi: number },
): [number, number, number] {
  const r = clampDistance(orbit.distance);
  const phi = clampPhi(orbit.phi);
  const sinPhi = Math.sin(phi);
  return [
    target.x + r * sinPhi * Math.sin(orbit.theta),
    target.y + r * Math.cos(phi),
    target.z + r * sinPhi * Math.cos(orbit.theta),
  ];
}

/* ------------------------------------------------------------------ *
 * 現場3D（viewScope: "site"）用のカメラ
 *
 * 地区全体（既定 620m）とはスケールが2桁違うため、現場の寸法から
 * 距離を導出する。呼び出し側（PublicTwinViewer / Site3DGallery /
 * 現場詳細タブ）はこの関数だけを使えば見た目が揃う。
 * ------------------------------------------------------------------ */

/** 現場3Dのフォーカス距離の下限 (m) */
export const SITE_FOCUS_MIN_DISTANCE_M = 72;

export interface SiteCamera {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

/**
 * 現場の寸法に合わせたカメラプリセット。
 * id は地区全体のプリセット（overview / top / front）と共通。
 */
export function sitePresets(radiusM: number): CameraPreset[] {
  const r = Math.max(10, radiusM);
  return [
    {
      id: "overview",
      label: "標準",
      distance: clampDistance(Math.max(SITE_FOCUS_MIN_DISTANCE_M, r * 4.0)),
      theta: -0.72,
      phi: 0.90,
      description: "現場を斜め上から見る（周辺の街並みを文脈として添える）",
    },
    {
      id: "top",
      label: "俯瞰",
      distance: clampDistance(Math.max(SITE_FOCUS_MIN_DISTANCE_M * 1.2, r * 4.8)),
      theta: 0,
      phi: 0.22,
      description: "真上から工区と道路の位置関係を見る",
    },
    {
      id: "front",
      label: "正面",
      distance: clampDistance(Math.max(SITE_FOCUS_MIN_DISTANCE_M * 0.8, r * 3.0)),
      theta: -Math.PI / 2,
      phi: 1.18,
      description: "西側から水平に近い高さで見る",
    },
  ];
}

export function sitePresetById(id: CameraPresetId, radiusM: number): CameraPreset {
  const presets = sitePresets(radiusM);
  return presets.find((preset) => preset.id === id) ?? presets[0];
}

/**
 * `projectId` から現場3Dの推奨カメラを返す。
 *
 * 未発見の場合は基準点周辺の汎用値（例外は投げない）。
 * `<Canvas camera={{ position, fov }}>` に渡し、`target` は
 * OrbitControls の `target` に渡す想定。
 */
export function siteCameraFor(projectId: string): SiteCamera {
  const fov = 45;
  const project = getProjectById(projectId);
  if (!project) {
    return { position: [-140, 96, 150], target: [0, 8, 0], fov };
  }

  const data = buildSiteModelData(project);
  const radius = siteRadius(data);
  const radiusTop = Math.max(2, Math.min(structureHeight(data) * 0.45 + 1, radius * 0.55));
  const preset = sitePresetById("overview", radius);
  const target: Vec3Like = { x: 0, y: radiusTop, z: 0 };
  return { position: cameraPositionFor(target, preset), target: [0, radiusTop, 0], fov };
}
