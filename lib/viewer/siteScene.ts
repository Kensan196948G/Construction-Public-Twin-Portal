/**
 * 現場ごとの3Dシーン（SiteScene）の**純ロジック**。
 *
 * 目的: 「1現場 = 1つの3D」を成立させるため、案件中心を原点とする
 * ローカル座標（x = 東, y = 高さ, z = 南。`lib/site/sceneData.ts` と同じ流儀）で
 * 各データレイヤーの形状を**決定的に**組み立てる。
 *
 * ここには React / three への依存を持ち込まない（数値配列のみを返す）。
 * 描画は `components/viewer/SiteDataLayers.tsx` が担当する。
 *
 * すべて `lib/site/sceneData.ts` の `SiteModelData`（＝実データ未接続のため
 * 案件IDから決定的に生成したサンプル）を入力とする。
 */
import type {
  AiPinSeverity,
  CaptureKind,
  InspectionStatus,
  SiteModelData,
} from "@/lib/site/sceneData";
import { mulberry32 } from "@/lib/viewer/sceneBuilder";

/** three.js と構造的に互換な3次元タプル */
export type Vec3 = [number, number, number];

/* ------------------------------------------------------------------ *
 * 色
 *
 * 値は原則 `lib/store/useAppStore.ts` の `DATA_LAYERS[].swatch`
 * （および `lib/viewer/sceneBuilder.ts` の SCENE_COLORS）と揃えている。
 * three のマテリアルは数値 color を要求するため hex 数値で持つ。
 * ------------------------------------------------------------------ */

export const SITE_COLORS = {
  /** DATA_LAYERS: bim (#5b7cfa) */
  bimColumn: 0x5b7cfa,
  bimBeam: 0x4463dd,
  bimSlab: 0x9aabf7,
  /** DATA_LAYERS: cad (#e58212) */
  cadOutline: 0xe58212,
  cadGrid: 0xb96f1a,
  cadCenter: 0xf0a94a,
  /** DATA_LAYERS: pointcloud (#3fb6a8) */
  pointcloud: 0x3fb6a8,
  /** DATA_LAYERS: gaussian (#b06ae0) を上下のグラデーションへ展開 */
  gaussianBottom: 0x6f5cf0,
  gaussianTop: 0xe070c0,
  /** DATA_LAYERS: smartphone (#2f9d6b) / 撮影種別ごとに色を変える */
  captureSmartphone: 0x2f9d6b,
  captureCamera: 0x3b7dd8,
  captureUav: 0xe08a2e,
  /** DATA_LAYERS: photo (#d9a441) */
  photo: 0xd9a441,
  /** 進捗: 未着手=灰 / 完了=緑（SCENE_COLORS.statusCompleted と同値） */
  progressPending: 0x8a8f98,
  progressDone: 0x2f9d6b,
  /** 点検: ok / attention / repair */
  inspectionOk: 0x2f9d6b,
  inspectionAttention: 0xe08a2e,
  inspectionRepair: 0xd23b2e,
  /** DATA_LAYERS: trajectory (#d23b2e) */
  trajectory: 0xd23b2e,
  /** AI ピン: info / notice / warning（sev-pill と同じ色調） */
  aiInfo: 0x3b7dd8,
  aiNotice: 0xe08a2e,
  aiWarning: 0xd23b2e,
  /** 周辺の街並み・地面（SCENE_COLORS.building / road / plate） */
  context: 0xcfd3da,
  contextAlt: 0xc4c9d1,
  road: 0x6b7079,
  ground: 0xd6dae0,
} as const;

export function captureKindColor(kind: CaptureKind): number {
  switch (kind) {
    case "smartphone":
      return SITE_COLORS.captureSmartphone;
    case "camera":
      return SITE_COLORS.captureCamera;
    case "uav":
      return SITE_COLORS.captureUav;
  }
}

export function inspectionColor(status: InspectionStatus): number {
  switch (status) {
    case "ok":
      return SITE_COLORS.inspectionOk;
    case "attention":
      return SITE_COLORS.inspectionAttention;
    case "repair":
      return SITE_COLORS.inspectionRepair;
  }
}

export function aiPinColor(severity: AiPinSeverity): number {
  switch (severity) {
    case "info":
      return SITE_COLORS.aiInfo;
    case "notice":
      return SITE_COLORS.aiNotice;
    case "warning":
      return SITE_COLORS.aiWarning;
  }
}

/* ------------------------------------------------------------------ *
 * 高さ（レイヤー間の重なり順）
 * ------------------------------------------------------------------ */

export const SITE_LAYER_Y = {
  /** 地面プレート */
  ground: 0,
  /** 基礎スラブ */
  base: 0.1,
  /** CAD の輪郭線 */
  cadOutline: 0.55,
  /** CAD のグリッド線 */
  cadGrid: 0.5,
  /** CAD の中心線（最も上に出す） */
  cadCenter: 0.62,
  /** 工区の塗り */
  zone: 0.82,
  /** 進捗バーの底面 */
  progress: 1.0,
} as const;

/* ------------------------------------------------------------------ *
 * 施工状態・寸法の派生値
 * ------------------------------------------------------------------ */

/** 現場の代表半径 (m)。カメラ距離と地面プレートの寸法に使う。 */
export function siteRadius(data: SiteModelData): number {
  return Math.max(10, Math.max(data.width, data.depth) / 2);
}

/** 構造物（BIM・点群）の高さ。土木系は高さ 0 のため最低限の値へ丸める。 */
export function structureHeight(data: SiteModelData): number {
  if (data.height > 0) return data.height;
  return Math.max(2.4, data.bim.floorHeight);
}

/** BIM の階数（土木系は 1 層として扱う） */
export function bimLevels(data: SiteModelData): number {
  return Math.max(1, Math.min(24, data.floors));
}

/* ------------------------------------------------------------------ *
 * BIM（柱・梁・床スラブ）
 * ------------------------------------------------------------------ */

export type BimMemberKind = "column" | "beamX" | "beamZ" | "slab";

export interface BimMember {
  id: string;
  kind: BimMemberKind;
  /** 中心位置 (m) */
  position: Vec3;
  /** box 寸法 [幅, 高さ, 奥行] (m) */
  size: Vec3;
  /** 0 = 基礎、n = n 階の部材 */
  floor: number;
}

/** 部材数の上限（想定外に大きい案件でも描画を破綻させない） */
const BIM_MEMBER_LIMIT = 420;

/**
 * 構造グリッドを `bim` の寸法で生成し、階数分だけ繰り返す。
 * 柱 → 大梁（X/Z 方向） → 床スラブ の順に積む。
 */
export function buildBimMembers(data: SiteModelData): BimMember[] {
  const levels = bimLevels(data);
  const baysX = Math.max(1, Math.min(12, data.bim.baysX));
  const baysZ = Math.max(1, Math.min(12, data.bim.baysZ));
  const { columnSize, beamDepth, slabThickness, floorHeight } = data.bim;
  const halfW = data.width / 2;
  const halfD = data.depth / 2;
  const bayW = data.width / baysX;
  const bayD = data.depth / baysZ;
  const members: BimMember[] = [];

  // 基礎スラブ
  members.push({
    id: "bim-slab-base",
    kind: "slab",
    position: [0, SITE_LAYER_Y.base + slabThickness / 2, 0],
    size: [data.width, slabThickness, data.depth],
    floor: 0,
  });

  for (let f = 0; f < levels; f += 1) {
    const base = SITE_LAYER_Y.base + f * floorHeight;
    const beamY = base + floorHeight - beamDepth / 2;

    for (let i = 0; i <= baysX; i += 1) {
      for (let j = 0; j <= baysZ; j += 1) {
        members.push({
          id: `bim-col-${f}-${i}-${j}`,
          kind: "column",
          position: [-halfW + i * bayW, base + floorHeight / 2, -halfD + j * bayD],
          size: [columnSize, floorHeight, columnSize],
          floor: f,
        });
      }
    }

    for (let j = 0; j <= baysZ; j += 1) {
      members.push({
        id: `bim-bx-${f}-${j}`,
        kind: "beamX",
        position: [0, beamY, -halfD + j * bayD],
        size: [data.width, beamDepth, Math.max(0.24, columnSize * 0.8)],
        floor: f,
      });
    }

    for (let i = 0; i <= baysX; i += 1) {
      members.push({
        id: `bim-bz-${f}-${i}`,
        kind: "beamZ",
        position: [-halfW + i * bayW, beamY, 0],
        size: [Math.max(0.24, columnSize * 0.8), beamDepth, data.depth],
        floor: f,
      });
    }

    members.push({
      id: `bim-slab-${f + 1}`,
      kind: "slab",
      position: [0, base + floorHeight - slabThickness / 2, 0],
      size: [data.width, slabThickness, data.depth],
      floor: f + 1,
    });

    if (members.length >= BIM_MEMBER_LIMIT) {
      return members.slice(0, BIM_MEMBER_LIMIT);
    }
  }

  return members.slice(0, BIM_MEMBER_LIMIT);
}

/* ------------------------------------------------------------------ *
 * CAD（平面図オーバーレイ）
 * ------------------------------------------------------------------ */

export type CadLineKind = "outline" | "grid" | "center" | "dimension";

export interface CadLine {
  id: string;
  kind: CadLineKind;
  points: Vec3[];
  dashed: boolean;
}

/**
 * 平面図の線分。地面付近（SITE_LAYER_Y）に薄く重ねる。
 * outline / centerLines / gridLines に、寸法線（offset）を加える。
 */
export function buildCadLines(data: SiteModelData): CadLine[] {
  const lines: CadLine[] = [];
  const halfW = data.width / 2;
  const halfD = data.depth / 2;

  lines.push({
    id: "cad-outline",
    kind: "outline",
    dashed: false,
    points: data.cad.outline.map(([x, z]) => [x, SITE_LAYER_Y.cadOutline, z] as Vec3),
  });

  data.cad.gridLines.forEach((ring, index) => {
    if (ring.length < 2) return;
    lines.push({
      id: `cad-grid-${index}`,
      kind: "grid",
      dashed: false,
      points: ring.map(([x, z]) => [x, SITE_LAYER_Y.cadGrid, z] as Vec3),
    });
  });

  data.cad.centerLines.forEach((ring, index) => {
    if (ring.length < 2) return;
    lines.push({
      id: `cad-center-${index}`,
      kind: "center",
      dashed: true,
      points: ring.map(([x, z]) => [x, SITE_LAYER_Y.cadCenter, z] as Vec3),
    });
  });

  // 寸法線（敷地の外側に offset 分だけ離して引く）
  const o = Math.max(1.5, data.cad.offset);
  const y = SITE_LAYER_Y.cadOutline;
  const dims: [string, Vec3[]][] = [
    [
      "cad-dim-s",
      [
        [-halfW - o, y, -halfD - o],
        [halfW + o, y, -halfD - o],
      ],
    ],
    [
      "cad-dim-n",
      [
        [-halfW - o, y, halfD + o],
        [halfW + o, y, halfD + o],
      ],
    ],
    [
      "cad-dim-w",
      [
        [-halfW - o, y, -halfD - o],
        [-halfW - o, y, halfD + o],
      ],
    ],
    [
      "cad-dim-e",
      [
        [halfW + o, y, -halfD - o],
        [halfW + o, y, halfD + o],
      ],
    ],
  ];
  for (const [id, points] of dims) {
    lines.push({ id, kind: "dimension", dashed: false, points });
  }

  return lines;
}

/* ------------------------------------------------------------------ *
 * 点群
 * ------------------------------------------------------------------ */

/** 点群の点数上限（full / thumbnail で切り替える） */
export const POINTCLOUD_LIMIT = { full: 6000, thumbnail: 700 } as const;

/**
 * 点群の座標（インターリーブしない Float32Array）。
 * 表面（屋根・ファサード）と地面に決定的に散布する。
 */
export function buildPointCloudPositions(data: SiteModelData, limit?: number): Float32Array {
  const max = limit ?? POINTCLOUD_LIMIT.full;
  const count = Math.max(0, Math.min(data.pointcloud.count, max));
  const out = new Float32Array(count * 3);
  if (count === 0) return out;

  const rand = mulberry32(data.pointcloud.seed);
  const halfW = data.width / 2;
  const halfD = data.depth / 2;
  const top = structureHeight(data);
  const jitter = Math.max(0.05, data.pointcloud.jitter);

  for (let i = 0; i < count; i += 1) {
    const mode = rand();
    const a = rand();
    const b = rand();
    let x: number;
    let y: number;
    let z: number;

    if (mode < 0.45) {
      // 屋根面
      x = -halfW + data.width * a;
      z = -halfD + data.depth * b;
      y = top + (rand() - 0.5) * jitter * 2;
    } else if (mode < 0.58) {
      // 地面（敷地の周囲まで広げて足元の点を出す）
      x = (-halfW + data.width * a) * 1.3;
      z = (-halfD + data.depth * b) * 1.3;
      y = rand() * jitter;
    } else {
      // ファサード（外周の壁面）
      const face = rand();
      if (face < 0.5) {
        x = (rand() < 0.5 ? -halfW : halfW) + (rand() - 0.5) * jitter;
        z = -halfD + data.depth * a;
      } else {
        x = -halfW + data.width * a;
        z = (rand() < 0.5 ? -halfD : halfD) + (rand() - 0.5) * jitter;
      }
      y = rand() * top;
    }

    const k = i * 3;
    out[k] = x + (rand() - 0.5) * jitter;
    out[k + 1] = y;
    out[k + 2] = z + (rand() - 0.5) * jitter;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * 3DGS（ガウシアンスプラッティング相当）
 * ------------------------------------------------------------------ */

/** スプラット数上限（点群より少なく、1つあたりを大きく描く） */
export const GAUSSIAN_LIMIT = { full: 1400, thumbnail: 180 } as const;

export interface GaussianCloud {
  positions: Float32Array;
  /** スプラットの基準サイズ (m) */
  sizes: Float32Array;
  /** RGB（0..1） */
  colors: Float32Array;
}

/**
 * 半透明の大きめスプラット。構造物を包むように分布させ、
 * 高さ方向で色を変える（点群と見た目が明確に異なることが要件）。
 */
export function buildGaussianCloud(data: SiteModelData, limit?: number): GaussianCloud {
  const max = limit ?? GAUSSIAN_LIMIT.full;
  const count = Math.max(0, Math.min(data.gaussian.count, max));
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  if (count === 0) return { positions, sizes, colors };

  const rand = mulberry32(data.gaussian.seed);
  const halfW = data.width / 2;
  const halfD = data.depth / 2;
  const h = structureHeight(data);
  const base = data.gaussian.size;

  const from = hexToRgb(SITE_COLORS.gaussianBottom);
  const to = hexToRgb(SITE_COLORS.gaussianTop);

  for (let i = 0; i < count; i += 1) {
    const x = (rand() * 2 - 1) * halfW * 1.12;
    const z = (rand() * 2 - 1) * halfD * 1.12;
    const t = rand();
    const y = 0.6 + t * (h * 1.08);
    const k = i * 3;
    positions[k] = x;
    positions[k + 1] = y;
    positions[k + 2] = z;
    sizes[i] = base * (0.55 + rand() * 1.05);
    colors[k] = from[0] + (to[0] - from[0]) * t;
    colors[k + 1] = from[1] + (to[1] - from[1]) * t;
    colors[k + 2] = from[2] + (to[2] - from[2]) * t;
  }

  return { positions, sizes, colors };
}

function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

/* ------------------------------------------------------------------ *
 * 施工進捗
 * ------------------------------------------------------------------ */

export type ProgressState = "pending" | "active" | "done";

export interface ProgressBar {
  id: string;
  label: string;
  ratio: number;
  state: ProgressState;
  color: number;
  /** 未着手部分も含めた帯 */
  base: { position: Vec3; size: Vec3 };
  /** 進捗ぶんの塗り（ratio = 0 のときは null） */
  fill: { position: Vec3; size: Vec3 } | null;
}

/**
 * `progress.phases` の ratio に応じて `span` 区間を色分けする。
 *   未着手 = 灰 / 進行中 = 工程色 / 完了 = 緑
 */
export function buildProgressBars(data: SiteModelData): ProgressBar[] {
  const halfD = data.depth / 2;
  const z = -halfD * 0.76;
  const barDepth = Math.max(3.2, Math.min(8, data.depth * 0.14));
  const height = 0.9;
  const gap = Math.max(0.6, data.width * 0.012);

  return data.progress.phases.map((phase) => {
    const [x0, x1] = phase.span;
    const spanW = Math.max(1.2, x1 - x0 - gap);
    const centerX = (x0 + x1) / 2;
    const ratio = Math.max(0, Math.min(1, phase.ratio));
    const state: ProgressState = ratio >= 1 ? "done" : ratio > 0 ? "active" : "pending";
    const color =
      state === "done" ? SITE_COLORS.progressDone : state === "pending" ? SITE_COLORS.progressPending : phase.color;

    const base: ProgressBar["base"] = {
      position: [centerX, SITE_LAYER_Y.progress + height / 2, z],
      size: [spanW, height, barDepth],
    };

    if (ratio <= 0) {
      return { id: phase.id, label: phase.label, ratio, state, color, base, fill: null };
    }

    const fillW = Math.max(0.6, spanW * ratio);
    return {
      id: phase.id,
      label: phase.label,
      ratio,
      state,
      color,
      base,
      fill: {
        position: [centerX - spanW / 2 + fillW / 2, SITE_LAYER_Y.progress + height / 2, z],
        size: [fillW, height, barDepth * 1.02],
      },
    };
  });
}

/* ------------------------------------------------------------------ *
 * 周辺の街並み（文脈）
 *
 * 現場3Dでは「その現場の周り」だけを控えめに描く。案件IDから決定的に
 * 生成するため、同じ案件は常に同じ街並みになり、24現場が互いに区別できる。
 * ------------------------------------------------------------------ */

export interface SiteContextBuilding {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  alt: boolean;
}

export interface SiteContextRoad {
  id: string;
  /** 道路が伸びる軸 */
  axis: "x" | "z";
  /** 軸に直交する方向の位置 */
  offset: number;
  width: number;
  length: number;
}

export interface SiteContext {
  buildings: SiteContextBuilding[];
  roads: SiteContextRoad[];
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 敷地の外側に立つ周辺建物と、交差する2本の道路 */
export function buildSiteContext(data: SiteModelData, count = 14): SiteContext {
  const rand = mulberry32(hashString(`${data.projectId}:context`));
  const halfW = data.width / 2;
  const halfD = data.depth / 2;
  const reach = Math.max(halfW, halfD);

  const buildings: SiteContextBuilding[] = [];
  let guard = 0;
  while (buildings.length < count && guard < count * 12) {
    guard += 1;
    const side = Math.floor(rand() * 4);
    const dist = reach + 16 + rand() * reach * 1.6;
    const along = (rand() * 2 - 1) * (reach + 30);
    const w = 10 + rand() * 22;
    const d = 10 + rand() * 22;
    let x: number;
    let z: number;
    if (side === 0) {
      x = along;
      z = -dist;
    } else if (side === 1) {
      x = along;
      z = dist;
    } else if (side === 2) {
      x = -dist;
      z = along;
    } else {
      x = dist;
      z = along;
    }
    // 敷地（+余白）に重なるものは建てない
    if (Math.abs(x) < halfW + w / 2 + 3 && Math.abs(z) < halfD + d / 2 + 3) continue;
    buildings.push({
      id: `ctx-${buildings.length}`,
      x: Number(x.toFixed(2)),
      z: Number(z.toFixed(2)),
      w: Number(w.toFixed(2)),
      d: Number(d.toFixed(2)),
      h: Number((6 + rand() * 26).toFixed(2)),
      alt: rand() < 0.45,
    });
  }

  const roadOffset = reach + 12;
  const roads: SiteContextRoad[] = [
    {
      id: "ctx-road-x",
      axis: "x",
      offset: -roadOffset,
      width: 13,
      length: Math.max(120, data.width * 4),
    },
    {
      id: "ctx-road-z",
      axis: "z",
      offset: roadOffset,
      width: 11,
      length: Math.max(120, data.depth * 4),
    },
  ];

  return { buildings, roads };
}

/* ------------------------------------------------------------------ *
 * 撮影位置まわり
 * ------------------------------------------------------------------ */

/** 撮影位置に貼る写真パネルの寸法 (m) */
export const CAPTURE_PANEL = { width: 3.4, height: 2.5 } as const;

/** 写真パネルの表示上限（full / thumbnail） */
export const PHOTO_LIMIT = { full: 6, thumbnail: 3 } as const;

/** 撮影軌跡の頂点（撮影位置を撮影順に結ぶ） */
export function trajectoryPoints(data: SiteModelData): Vec3[] {
  return data.trajectory.map(([x, y, z]) => [x, y, z] as Vec3);
}
