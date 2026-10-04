/**
 * 3D シーンの手続き生成（外部アセット・外部ネットワークに依存しない）。
 *
 * 出典: WebUI/koji-mieru-map-3d.html の
 *   - buildCityLayout()（周辺建物・区画・公園・街路樹）
 *   - buildCompletion()（完成予想の手続きモデル）
 * を、React Three Fiber から使いやすい **純データ** として移植したもの。
 *
 * このファイルは three.js を import しない（three のオブジェクトを生成しない）。
 * 生成物は ScenePart / CityLayout などのプレーンなデータで、
 * components/viewer/** 側が宣言的にメッシュへ変換する。
 * → 副作用が無く、テスト（tests/** は apidata 担当）からも扱いやすい。
 *
 * 色について:
 *   3D マテリアルの色は CSS トークン（oklch）を three.js が解釈できないため、
 *   デザインハンドオフの THREE パレット（同 HTML の `C`）と
 *   lib/store/useAppStore.ts の LAYERS.swatch の値をここに集約する。
 *   UI（CSS）側ではこれらの色を直接使わないこと。
 */
import { lngLatToScene } from "@/lib/geo/transform";
import type { CompletionType, Project, ProjectStatus } from "@/lib/schemas/project";

/* ------------------------------------------------------------------ *
 * パレット（デザインハンドオフの C / LAYERS.swatch と同値）
 * ------------------------------------------------------------------ */

export const SCENE_COLORS = {
  /** 空（シーン背景）とフォグ */
  sky: 0xe9edf2,
  fog: 0xe9edf2,

  /** 地形・地盤 */
  ground: 0x5a606a,
  terrain: 0x8fb98a,
  contour: 0x6d737d,
  hill: 0x646a74,

  /** 都市モデル */
  plate: 0xd6dae0,
  park: 0x8fb98a,
  building: 0xcfd3da,
  buildingAlt: 0xc4c9d1,
  glass: 0xaeb6c2,
  road: 0x4a505a,
  roadSurface: 0x6b7079,
  roadPaint: 0xf0f0f0,
  treeCrown: 0x6f9c6a,
  treeTrunk: 0x8a6f52,
  water: 0x8fbfd6,

  /** 施工状態（LAYERS の planned/active/reg/done と揃える） */
  statusPlanned: 0x3b7dd8,
  statusActive: 0xe08a2e,
  statusCompleted: 0x2f9d6b,
  statusSuspended: 0x8a8f98,

  /** 影響レイヤー（LAYERS.swatch） */
  regulation: 0xd23b2e,
  detour: 0x35a3c4,
  pedestrian: 0x7a53c9,

  /** 完成予想モデル */
  completion: 0xeef1f5,
  completionGlass: 0x9fb6c9,
  completionGreen: 0x7fae76,
  completionRoof: 0xbfc6cc,
  pave: 0xd2d6dc,
  fence: 0xdfe3e8,
  soil: 0x8a7455,
  soilDark: 0x6b5f4e,
  tactile: 0xc9a227,
  steel: 0x8a949e,
  pipeGray: 0x6b7280,
  pipeBlue: 0x4f8fbf,
  coneOrange: 0xe0662b,
  markerPole: 0x2b3038,
} as const;

/** THREE の hex を CSS 文字列へ（デバッグ・テスト・SVG 比較用） */
export function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

/** 施工状態の色 */
export function statusColor(status: ProjectStatus): number {
  switch (status) {
    case "planned":
      return SCENE_COLORS.statusPlanned;
    case "under_construction":
      return SCENE_COLORS.statusActive;
    case "completed":
      return SCENE_COLORS.statusCompleted;
    case "suspended":
      return SCENE_COLORS.statusSuspended;
  }
}

/* ------------------------------------------------------------------ *
 * 基本型
 * ------------------------------------------------------------------ */

export interface Vec2 {
  x: number;
  z: number;
}

/** 平面矩形（中心 + 寸法）。x = 東西, z = 南北 */
export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface BuildingBox {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** 色違い（C.built2）を使うか */
  alt: boolean;
  /** ガラス面（C.glass）を使うか */
  glass: boolean;
}

export interface TreeSpot {
  x: number;
  z: number;
  scale: number;
}

export interface CityLayout {
  plates: Rect[];
  parks: Rect[];
  buildings: BuildingBox[];
  trees: TreeSpot[];
}

export interface Segment {
  a: Vec2;
  b: Vec2;
}

export interface Mound {
  x: number;
  z: number;
  radius: number;
  height: number;
}

/* ------------------------------------------------------------------ *
 * 乱数（決定的）
 * ------------------------------------------------------------------ */

/** 決定的な擬似乱数。同じ seed なら常に同じ街並みになる。 */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * 都市レイアウト
 * ------------------------------------------------------------------ */

export const CITY_SEED = 20261004;
/** 都市モデルの生成範囲（基準点から ±840m） */
export const CITY_EXTENT_M = 840;
/** 街区のグリッド間隔 */
export const CITY_STEP_M = 80;
/** 基準点直近は空けておく半径 */
export const CITY_CLEAR_RADIUS_M = 58;
/** 駅前公園として確保する区画 */
export const CITY_PARK_AREA: Rect = { x: 120, z: 220, w: 160, d: 200 };

export interface BuildCityOptions {
  seed?: number;
  extent?: number;
  step?: number;
  clearRadius?: number;
  /** 工区と重なる街区は建物を建てない（プレートのみ） */
  avoid?: readonly Rect[];
  parkArea?: Rect;
}

function insideRect(x: number, z: number, r: Rect): boolean {
  return Math.abs(x - r.x) < r.w / 2 && Math.abs(z - r.z) < r.d / 2;
}

/**
 * 周辺の簡易都市モデルを生成する。
 * すべて決定的で、外部データを参照しない。
 */
export function buildCityLayout(options: BuildCityOptions = {}): CityLayout {
  const seed = options.seed ?? CITY_SEED;
  const extent = options.extent ?? CITY_EXTENT_M;
  const step = options.step ?? CITY_STEP_M;
  const clearRadius = options.clearRadius ?? CITY_CLEAR_RADIUS_M;
  const parkArea = options.parkArea ?? CITY_PARK_AREA;
  const avoid = options.avoid ?? [];

  const rnd = mulberry32(seed);
  const plates: Rect[] = [];
  const parks: Rect[] = [];
  const buildings: BuildingBox[] = [];
  const trees: TreeSpot[] = [];

  for (let x = -extent; x < extent; x += step) {
    for (let z = -extent; z < extent; z += step) {
      const cx = x + step / 2;
      const cz = z + step / 2;
      const dist = Math.hypot(cx, cz);
      if (dist < clearRadius) continue;

      if (insideRect(cx, cz, parkArea)) {
        parks.push({ x: cx, z: cz, w: 74, d: 74 });
        continue;
      }

      const nearSite = avoid.some(
        (a) => Math.abs(cx - a.x) < a.w / 2 + 8 && Math.abs(cz - a.z) < a.d / 2 + 8,
      );
      if (nearSite) {
        plates.push({ x: cx, z: cz, w: step - 12, d: step - 12 });
        continue;
      }

      // 郊外は疎に。公園にするか、何も置かない。
      if (dist > 520 && rnd() < 0.35) {
        if (rnd() < 0.6) parks.push({ x: cx, z: cz, w: step - 14, d: step - 14 });
        continue;
      }

      plates.push({ x: cx, z: cz, w: step - 12, d: step - 12 });

      const count = dist < 260 ? 3 : dist < 520 ? 2 : 1;
      const hmax = dist < 300 ? 52 : dist < 560 ? 34 : 22;
      for (let b = 0; b < count; b += 1) {
        const bw = 10 + rnd() * 16;
        const bd = 10 + rnd() * 16;
        const bx = cx + (rnd() - 0.5) * (step - 24 - bw);
        const bz = cz + (rnd() - 0.5) * (step - 24 - bd);
        const bh = 8 + rnd() * rnd() * hmax;
        const alt = rnd() < 0.22;
        const glass = rnd() < 0.3;
        buildings.push({ x: bx, z: bz, w: bw, d: bd, h: bh, alt, glass });
      }

      if (rnd() < 0.45) {
        trees.push({
          x: cx + (rnd() - 0.5) * (step - 18),
          z: cz + (rnd() - 0.5) * (step - 18),
          scale: 0.8 + rnd() * 0.8,
        });
      }
    }
  }

  return { plates, parks, buildings, trees };
}

/** 交差する幹線道路（プロトタイプと同じ 2 本） */
export const ROADS = {
  eastWest: { widthM: 26, lengthM: 2600 },
  northSouth: { widthM: 26, lengthM: 2600 },
} as const;

/** 道路センターラインの破線設定 */
export const ROAD_DASH = { dash: 12, gap: 10 } as const;

/** 地形の等高線（基準点からの半径, m） */
export const CONTOUR_RADII = [140, 260, 420, 620, 860] as const;

/**
 * 地形の緩やかな起伏（決定的に配置）。
 * 都市モデル（±840m）と重ならないよう、その外側に遠景の丘陵として置く。
 */
export function buildMounds(): Mound[] {
  const rnd = mulberry32(CITY_SEED + 7);
  const mounds: Mound[] = [];
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2 + 0.4;
    const radius = 980 + rnd() * 420;
    mounds.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      radius: 180 + rnd() * 140,
      height: 10 + rnd() * 22,
    });
  }
  return mounds;
}

/* ------------------------------------------------------------------ *
 * 完成予想モデル（手続き生成）
 * ------------------------------------------------------------------ */

export type ScenePartShape =
  | { kind: "box"; size: [number, number, number] }
  | { kind: "cylinder"; radius: number; height: number; radialSegments?: number }
  | { kind: "sphere"; radius: number; radialSegments?: number }
  | { kind: "cone"; radius: number; height: number; radialSegments?: number };

export interface ScenePart {
  id: string;
  shape: ScenePartShape;
  position: [number, number, number];
  rotation?: [number, number, number];
  color: number;
  opacity?: number;
  /** 主要素（比較モードで輪郭を強調する） */
  primary?: boolean;
}

type PartExtra = Pick<ScenePart, "rotation" | "opacity" | "primary">;

export interface CompletionDims {
  widthM: number;
  depthM: number;
  floors: number;
}

function clampSize(value: number, min: number): number {
  return Math.max(min, value);
}

/**
 * 完成予想の手続きモデル。工区のローカル座標（中心 = 原点, y = 高さ）で返す。
 * 8 種（plaza / sidewalk / utility / park / tower / rural / road / levee）で
 * シルエットが明確に変わるように構成している。
 */
export function buildCompletionParts(
  type: CompletionType,
  dims: CompletionDims,
): ScenePart[] {
  const w = clampSize(dims.widthM, 8);
  const d = clampSize(dims.depthM, 8);
  const floors = Math.max(0, dims.floors);
  const parts: Omit<ScenePart, "id">[] = [];

  const box = (
    size: [number, number, number],
    position: [number, number, number],
    color: number,
    extra: PartExtra = {},
  ) => {
    parts.push({ shape: { kind: "box", size }, position, color, ...extra });
  };
  const cylinder = (
    radius: number,
    height: number,
    position: [number, number, number],
    color: number,
    extra: PartExtra = {},
    radialSegments = 16,
  ) => {
    parts.push({
      shape: { kind: "cylinder", radius, height, radialSegments },
      position,
      color,
      ...extra,
    });
  };
  const sphere = (radius: number, position: [number, number, number], color: number) => {
    parts.push({ shape: { kind: "sphere", radius, radialSegments: 12 }, position, color });
  };
  const cone = (
    radius: number,
    height: number,
    position: [number, number, number],
    color: number,
    extra: PartExtra = {},
  ) => {
    parts.push({ shape: { kind: "cone", radius, height, radialSegments: 12 }, position, color, ...extra });
  };
  /** 街路樹（幹 + 樹冠） */
  const tree = (x: number, z: number, scale = 1) => {
    cylinder(0.5 * scale, 3 * scale, [x, 1.5 * scale, z], SCENE_COLORS.treeTrunk, {}, 8);
    sphere(2.6 * scale, [x, 3.4 * scale, z], SCENE_COLORS.treeCrown);
  };
  const bench = (x: number, z: number) => {
    box([3.6, 0.4, 1.1], [x, 0.75, z], SCENE_COLORS.completion);
    box([0.4, 0.5, 1.1], [x - 1.6, 0.4, z], SCENE_COLORS.steel);
    box([0.4, 0.5, 1.1], [x + 1.6, 0.4, z], SCENE_COLORS.steel);
  };

  switch (type) {
    /* --- 駅前広場 --- */
    case "plaza": {
      const pw = Math.min(26, w * 0.32);
      const pd = Math.min(18, d * 0.4);
      box([w * 1.02, 0.35, d * 1.02], [0, 0.3, 0], SCENE_COLORS.pave, { primary: true });
      box([pw, 10, pd], [-w * 0.18, 5.5, d * 0.14], SCENE_COLORS.completionGlass, { primary: true });
      box([pw * 0.7, 7, pd * 0.8], [w * 0.1, 4, -d * 0.22], SCENE_COLORS.completion);
      // デッキと庇
      box([10, 0.4, 10], [w * 0.26, 4.9, d * 0.28], SCENE_COLORS.completion);
      cylinder(0.35, 4.6, [w * 0.26 - 4, 2.4, d * 0.28 - 4], SCENE_COLORS.steel, {}, 10);
      cylinder(0.35, 4.6, [w * 0.26 + 4, 2.4, d * 0.28 - 4], SCENE_COLORS.steel, {}, 10);
      cylinder(0.35, 4.6, [w * 0.26 - 4, 2.4, d * 0.28 + 4], SCENE_COLORS.steel, {}, 10);
      cylinder(0.35, 4.6, [w * 0.26 + 4, 2.4, d * 0.28 + 4], SCENE_COLORS.steel, {}, 10);
      box([6, 0.5, 2.4], [-w * 0.3, 1.2, -d * 0.3], SCENE_COLORS.completionGreen);
      bench(-w * 0.36, d * 0.34);
      bench(-w * 0.18, d * 0.34);
      tree(-w * 0.42, -d * 0.32, 1);
      tree(w * 0.02, d * 0.36, 0.9);
      tree(w * 0.34, -d * 0.3, 1.05);
      break;
    }

    /* --- 歩道・バリアフリー --- */
    case "sidewalk": {
      const lane = d * 0.3;
      box([w, 0.4, d], [0, 0.55, 0], SCENE_COLORS.roadSurface);
      box([w, 0.5, lane], [0, 0.85, -(d / 2 - lane / 2)], SCENE_COLORS.pave, { primary: true });
      box([w, 0.5, lane], [0, 0.85, d / 2 - lane / 2], SCENE_COLORS.pave, { primary: true });
      box([w, 0.7, 0.5], [0, 1.0, -(d / 2 - lane)], SCENE_COLORS.fence);
      box([w, 0.7, 0.5], [0, 1.0, d / 2 - lane], SCENE_COLORS.fence);
      box([w * 0.94, 0.1, 0.6], [0, 1.14, -(d / 2 - lane / 2)], SCENE_COLORS.tactile);
      box([w * 0.94, 0.1, 0.6], [0, 1.14, d / 2 - lane / 2], SCENE_COLORS.tactile);
      // 横断部（歩道の切り下げ）
      box([2.4, 0.22, d * 0.9], [-6, 1.0, 0], SCENE_COLORS.tactile);
      box([2.4, 0.22, d * 0.9], [6, 1.0, 0], SCENE_COLORS.tactile);
      tree(-w * 0.3, -(d / 2 - lane / 2), 0.9);
      tree(0, -(d / 2 - lane / 2), 0.85);
      tree(w * 0.3, -(d / 2 - lane / 2), 0.9);
      tree(-w * 0.18, d / 2 - lane / 2, 0.9);
      tree(w * 0.18, d / 2 - lane / 2, 0.9);
      break;
    }

    /* --- 地下管路 --- */
    case "utility": {
      const span = w * 0.84;
      // 開削した溝
      box([w * 0.92, 0.6, d * 0.6], [0, 0.3, 0], SCENE_COLORS.soil, { primary: true, opacity: 0.95 });
      box([w * 0.86, 0.35, d * 0.5], [0, 0.5, 0], SCENE_COLORS.soilDark);
      // 埋設管 3 条（上から見えるよう僅かに浮かせる）
      cylinder(1.0, span, [0, 1.7, -d * 0.18], SCENE_COLORS.pipeBlue, { rotation: [0, 0, Math.PI / 2] }, 12);
      cylinder(1.0, span, [0, 2.0, 0], SCENE_COLORS.pipeGray, { rotation: [0, 0, Math.PI / 2] }, 12);
      cylinder(1.0, span, [0, 1.7, d * 0.18], SCENE_COLORS.tactile, { rotation: [0, 0, Math.PI / 2] }, 12);
      // マンホールと弁室
      cylinder(2.0, 0.4, [-w * 0.26, 0.75, 0], SCENE_COLORS.pipeGray, {}, 18);
      cylinder(2.0, 0.4, [w * 0.26, 0.75, 0], SCENE_COLORS.pipeGray, {}, 18);
      box([3, 0.7, 3], [0, 0.85, -d * 0.24], SCENE_COLORS.steel);
      box([3, 0.7, 3], [0, 0.85, d * 0.24], SCENE_COLORS.steel);
      // 土留め（矢板）
      const pileCount = Math.max(4, Math.round(w / 16));
      for (let i = 0; i < pileCount; i += 1) {
        const px = -w * 0.46 + ((i + 0.5) * (w * 0.92)) / pileCount;
        box([1.0, 3.0, 1.0], [px, 1.5, -d * 0.3], SCENE_COLORS.steel);
        box([1.0, 3.0, 1.0], [px, 1.5, d * 0.3], SCENE_COLORS.steel);
      }
      cone(0.9, 2.2, [-w * 0.36, 1.1, d * 0.34], SCENE_COLORS.coneOrange);
      cone(0.9, 2.2, [w * 0.36, 1.1, d * 0.34], SCENE_COLORS.coneOrange);
      break;
    }

    /* --- 公園・防災広場 --- */
    case "park": {
      const pond = Math.min(9, d * 0.18);
      box([w * 1.02, 0.3, d * 1.02], [0, 0.28, 0], SCENE_COLORS.completionGreen, { primary: true });
      box([14, 5, 8], [-w * 0.3, 2.9, d * 0.3], SCENE_COLORS.completion, { primary: true });
      box([14.6, 0.6, 8.6], [-w * 0.3, 5.6, d * 0.3], SCENE_COLORS.completionRoof);
      cylinder(pond, 0.25, [w * 0.3, 0.5, -d * 0.28], SCENE_COLORS.water, { opacity: 0.8 }, 20);
      // 防災倉庫（半透明のフレーム）
      box([9, 3.2, 6], [w * 0.28, 1.9, d * 0.3], SCENE_COLORS.fence, { opacity: 0.55 });
      // パーゴラ
      const px = -w * 0.34;
      const pz = -d * 0.3;
      for (const [ox, oz] of [
        [-3.6, -3.6],
        [3.6, -3.6],
        [-3.6, 3.6],
        [3.6, 3.6],
      ] as const) {
        cylinder(0.3, 4.4, [px + ox, 2.4, pz + oz], SCENE_COLORS.steel, {}, 10);
      }
      box([9, 0.4, 9], [px, 4.9, pz], SCENE_COLORS.completion);
      bench(-w * 0.05, d * 0.12);
      bench(w * 0.12, d * 0.12);
      tree(-w * 0.4, -d * 0.36, 1.1);
      tree(-w * 0.1, d * 0.38, 1.0);
      tree(w * 0.22, -d * 0.06, 0.95);
      tree(w * 0.42, d * 0.34, 1.05);
      tree(-w * 0.3, -d * 0.02, 0.9);
      break;
    }

    /* --- 高層建築 --- */
    case "tower": {
      const height = Math.max(14, floors * 3.4 + 4);
      const pw = w * 0.78;
      const pd = d * 0.78;
      box([w * 1.02, 0.4, d * 1.02], [0, 0.32, 0], SCENE_COLORS.pave);
      box([pw, 7, pd], [0, 3.6, 0], SCENE_COLORS.completion);
      box([w * 0.5, height, d * 0.5], [0, height / 2, 0], SCENE_COLORS.completionGlass, { primary: true });
      box([w * 0.24, 3, d * 0.24], [0, height + 1.5, 0], SCENE_COLORS.completion);
      // エントランスと庇
      box([6, 4, 0.6], [0, 2.2, -pd / 2 - 0.3], SCENE_COLORS.completionGlass);
      box([w * 0.6, 0.5, 5], [0, 4.4, -pd / 2 - 2.5], SCENE_COLORS.completion);
      box([w * 0.9, 0.25, 3], [-w * 0.3, 7.6, d * 0.2], SCENE_COLORS.completion);
      tree(w * 0.4, d * 0.38, 1.0);
      tree(-w * 0.42, -d * 0.36, 1.1);
      break;
    }

    /* --- 低層施設 --- */
    case "rural": {
      box([w * 1.05, 0.3, d * 1.05], [0, 0.28, 0], SCENE_COLORS.pave);
      box([w * 0.52, 9, d * 0.5], [0, 4.5, 0], SCENE_COLORS.completion, { primary: true });
      box([w * 0.58, 0.7, d * 0.56], [0, 9.4, 0], SCENE_COLORS.completionRoof, { primary: true });
      box([6, 3.4, 3], [0, 1.7, -d * 0.3], SCENE_COLORS.completionGlass);
      box([w * 0.34, 0.2, d * 0.5], [-w * 0.32, 0.2, 0], SCENE_COLORS.roadSurface, { opacity: 0.85 });
      // 敷地のフェンス
      box([w * 0.9, 1.2, 0.2], [0, 0.9, -d * 0.46], SCENE_COLORS.fence, { opacity: 0.9 });
      box([w * 0.9, 1.2, 0.2], [0, 0.9, d * 0.46], SCENE_COLORS.fence, { opacity: 0.9 });
      box([0.2, 1.2, d * 0.92], [-w * 0.45, 0.9, 0], SCENE_COLORS.fence, { opacity: 0.9 });
      box([0.2, 1.2, d * 0.92], [w * 0.45, 0.9, 0], SCENE_COLORS.fence, { opacity: 0.9 });
      tree(w * 0.34, d * 0.28, 1.1);
      tree(w * 0.34, -d * 0.28, 0.9);
      break;
    }

    /* --- 道路改良 --- */
    case "road": {
      box([w, 0.4, d], [0, 0.7, 0], SCENE_COLORS.roadSurface, { primary: true });
      box([w, 0.5, 1.6], [0, 0.95, -(d / 2 - 0.8)], SCENE_COLORS.pave);
      box([w, 0.5, 1.6], [0, 0.95, d / 2 - 0.8], SCENE_COLORS.pave);
      // センターライン（破線）
      const dashCount = Math.max(3, Math.round(w / 18));
      for (let i = 0; i < dashCount; i += 1) {
        const dx = -w / 2 + ((i + 0.5) * w) / dashCount;
        box([w / dashCount * 0.55, 0.18, 0.9], [dx, 0.98, 0], SCENE_COLORS.roadPaint);
      }
      // 横断歩道
      for (let i = 0; i < 6; i += 1) {
        box([1.2, 0.16, d * 0.62], [(i - 2.5) * 2.4, 1.0, 0], SCENE_COLORS.roadPaint);
      }
      // 中央分離帯と街路灯
      box([10, 0.35, 3], [w * 0.3, 0.95, 0], SCENE_COLORS.completionGreen);
      for (const lx of [-w * 0.34, w * 0.34]) {
        cylinder(0.35, 9, [lx, 4.5, -(d / 2 + 2)], SCENE_COLORS.steel, {}, 8);
        box([2.0, 0.5, 0.8], [lx, 9.2, -(d / 2 + 2)], SCENE_COLORS.completion);
        cylinder(0.35, 9, [lx, 4.5, d / 2 + 2], SCENE_COLORS.steel, {}, 8);
        box([2.0, 0.5, 0.8], [lx, 9.2, d / 2 + 2], SCENE_COLORS.completion);
      }
      break;
    }

    /* --- 河川護岸 --- */
    case "levee": {
      box([w, 5.5, d * 0.72], [0, 2.75, 0], SCENE_COLORS.terrain, { primary: true });
      box([w, 1.1, d * 0.5], [0, 4.9, -d * 0.28], SCENE_COLORS.treeCrown, { rotation: [-0.5, 0, 0] });
      box([w, 1.1, d * 0.5], [0, 4.9, d * 0.28], SCENE_COLORS.treeCrown, { rotation: [0.5, 0, 0] });
      box([w, 0.6, 1.2], [0, 5.8, 0], SCENE_COLORS.completion);
      // 天端の転落防止柵
      box([w, 0.25, 0.25], [0, 6.8, -0.55], SCENE_COLORS.roadPaint);
      box([w, 0.25, 0.25], [0, 6.8, 0.55], SCENE_COLORS.roadPaint);
      const postCount = Math.max(4, Math.round(w / 14));
      for (let i = 0; i < postCount; i += 1) {
        const px = -w / 2 + ((i + 0.5) * w) / postCount;
        cylinder(0.16, 2.2, [px, 6.2, -0.55], SCENE_COLORS.steel, {}, 8);
        cylinder(0.16, 2.2, [px, 6.2, 0.55], SCENE_COLORS.steel, {}, 8);
      }
      // 河川水面（護岸の外側）
      box([w * 1.3, 0.12, d * 0.55], [0, 0.35, d * 0.75], SCENE_COLORS.water, { opacity: 0.72 });
      // 法面の植生ブロック
      for (let i = 0; i < 3; i += 1) {
        const gx = -w * 0.25 + i * w * 0.25;
        box([w * 0.16, 0.5, d * 0.24], [gx, 4.2, -d * 0.22], SCENE_COLORS.completionGreen);
      }
      break;
    }
  }

  return parts.map((part, index) => ({ ...part, id: `${type}-${index}` }));
}

/* ------------------------------------------------------------------ *
 * 座標・工区
 * ------------------------------------------------------------------ */

/** 工事の基準点をシーン座標へ */
export function projectSceneCenter(project: Project): Vec2 {
  const p = lngLatToScene(project.location.center.longitude, project.location.center.latitude);
  return { x: p.x, z: p.z };
}

/** 工区リング（ローカル [x, z]）をシーン座標のリングへ */
export function localRingToScene(
  center: Vec2,
  ring: readonly [number, number][],
): Vec2[] {
  return ring.map(([x, z]) => ({ x: center.x + x, z: center.z + z }));
}

/** リングを閉じる（先頭 = 末尾でなければ末尾に先頭を足す） */
export function closeRing(points: readonly Vec2[]): Vec2[] {
  if (points.length === 0) return [];
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x === last.x && first.z === last.z) return [...points];
  return [...points, first];
}

export interface RingBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function ringBounds(ring: readonly Vec2[]): RingBounds | null {
  if (ring.length === 0) return null;
  let minX = ring[0].x;
  let maxX = ring[0].x;
  let minZ = ring[0].z;
  let maxZ = ring[0].z;
  for (const p of ring) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

/** 工区の外接矩形（都市生成の avoid 用・カメラフォーカス用） */
export function rectFromRing(center: Vec2, ring: readonly [number, number][]): Rect | null {
  const bounds = ringBounds(localRingToScene(center, ring));
  if (!bounds) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
    w: Math.max(4, bounds.maxX - bounds.minX),
    d: Math.max(4, bounds.maxZ - bounds.minZ),
  };
}

/** 工区の代表半径（カメラ距離の決定に使う） */
export function projectRadius(project: Project): number {
  const radius = Math.max(project.visual.siteWidthM, project.visual.siteDepthM) / 2;
  return Math.max(18, radius);
}

/* ------------------------------------------------------------------ *
 * 時間
 * ------------------------------------------------------------------ */

/**
 * 表示日時における施工状態。
 * プロトタイプの statusAt() と同じ規則（工期の外は着工前 / 完成）。
 */
export function projectStatusAt(project: Project, viewTime: Date): ProjectStatus {
  const start = Date.parse(`${project.schedule.startDate}T00:00:00+09:00`);
  const end = Date.parse(`${project.schedule.plannedEndDate}T23:59:59+09:00`);
  const t = viewTime.getTime();
  if (Number.isFinite(start) && t < start) return "planned";
  if (Number.isFinite(end) && t > end) return "completed";
  return project.status;
}

/* ------------------------------------------------------------------ *
 * 線分・破線
 * ------------------------------------------------------------------ */

/** 3 次元の頂点列（drei の Line へ渡す形式） */
export function toLinePoints(points: readonly Vec2[], y: number): [number, number, number][] {
  return points.map((p) => [p.x, y, p.z] as [number, number, number]);
}

/** 折れ線の全長 */
export function polylineLength(points: readonly Vec2[], closed = false): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  if (closed && points.length > 1) {
    total += Math.hypot(points[0].x - points[points.length - 1].x, points[0].z - points[points.length - 1].z);
  }
  return total;
}

/** 破線の線分列（線幅は呼び出し側が指定する） */
export function dashSegments(
  points: readonly Vec2[],
  dash = 8,
  gap = 6,
  closed = false,
): Segment[] {
  const path = closed ? closeRing(points) : [...points];
  const segments: Segment[] = [];
  if (path.length < 2 || dash <= 0) return segments;
  const period = dash + Math.max(0, gap);

  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length === 0) continue;
    const ux = (b.x - a.x) / length;
    const uz = (b.z - a.z) / length;
    let travelled = 0;
    while (travelled < length) {
      const offset = travelled % period;
      const isDash = offset < dash;
      const remainingInPhase = isDash
        ? Math.min(dash - offset, length - travelled)
        : Math.min(period - offset, length - travelled);
      if (isDash && remainingInPhase > 0.01) {
        const x0 = a.x + ux * travelled;
        const z0 = a.z + uz * travelled;
        const x1 = a.x + ux * (travelled + remainingInPhase);
        const z1 = a.z + uz * (travelled + remainingInPhase);
        segments.push({ a: { x: x0, z: z0 }, b: { x: x1, z: z1 } });
      }
      travelled += remainingInPhase;
    }
  }
  return segments;
}
