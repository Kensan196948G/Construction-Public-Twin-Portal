/**
 * 現場ごとの3Dシーン用データ。
 *
 * 本 MVP には BIM / CAD / 点群 / 3DGS / 点検 / 指摘ピン の**実データが無い**ため、
 * プロジェクトIDから**決定的に**合成する（同じ案件なら常に同じ形状・同じ座標）。
 * すべて「サンプル（合成）データ」であり、UI 上でその旨を明示すること。
 *
 * 実データを接続する場合は、このモジュールの戻り値を外部ソースへ差し替えれば
 * 描画側（components/viewer, components/gallery）は変更不要となる。
 *
 * 座標系: **案件中心を原点**とする右手系。
 *   x = 東 (+), y = 高さ (+), z = 南 (+)
 * `lib/data/projects.ts` の `ProjectGeometry` と同じ流儀。
 */
import type { Project } from "@/lib/schemas/project";
import { PHOTO_FILES, PHOTO_CREDIT } from "@/lib/data/source";

/* ------------------------------------------------------------------ *
 * 決定的乱数
 * ------------------------------------------------------------------ */

/** 文字列 → 32bit シード */
function hashSeed(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32。同じシードなら常に同じ数列を返す。 */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (v: number, digits = 2) => Number(v.toFixed(digits));

/* ------------------------------------------------------------------ *
 * 型
 * ------------------------------------------------------------------ */

export type CaptureKind = "smartphone" | "camera" | "uav";

export interface CaptureShot {
  id: string;
  kind: CaptureKind;
  /** 撮影位置（案件中心原点・メートル） */
  position: [number, number, number];
  /** 注視点 */
  target: [number, number, number];
  /** サンプル写真（Wikimedia Commons 素材）。クレジットは PHOTO_CREDIT を参照。 */
  photoUrl: string;
  photoAuthor: string;
  photoLicense: string;
  photoSourceUrl: string;
  capturedAt: string;
  label: string;
}

export type InspectionStatus = "ok" | "attention" | "repair";

export interface InspectionRecord {
  id: string;
  position: [number, number, number];
  label: string;
  status: InspectionStatus;
  inspectedAt: string;
  note: string;
}

export type AiPinSeverity = "info" | "notice" | "warning";

export interface AiPin {
  id: string;
  position: [number, number, number];
  label: string;
  category: string;
  severity: AiPinSeverity;
  createdAt: string;
}

export interface ProgressPhase {
  id: string;
  label: string;
  /** 0..1 */
  ratio: number;
  from: string;
  to: string;
  color: string;
  /** この工程が担当する区間（ローカル座標の x 範囲） */
  span: [number, number];
}

export interface SiteProgress {
  /** 0..1 */
  overall: number;
  asOf: string;
  phases: ProgressPhase[];
}

export interface SiteModelData {
  projectId: string;
  slug: string;
  /** 現場のおおよその寸法 (m) */
  width: number;
  depth: number;
  /** 構造物の高さ (m)。土木系は低い。 */
  height: number;
  floors: number;

  /** BIM: 構造グリッド */
  bim: {
    baysX: number;
    baysZ: number;
    columnSize: number;
    beamDepth: number;
    slabThickness: number;
    /** 階高 (m) */
    floorHeight: number;
  };

  /** CAD: 平面図の線分（ローカル [x, z]） */
  cad: {
    outline: [number, number][];
    centerLines: [number, number][][];
    gridLines: [number, number][][];
    /** 寸法線の張り出し量 (m) */
    offset: number;
  };

  /** 点群 */
  pointcloud: { count: number; seed: number; jitter: number };
  /** 3DGS（ガウシアンスプラッティング相当） */
  gaussian: { count: number; seed: number; size: number };

  captures: CaptureShot[];
  trajectory: [number, number, number][];
  inspections: InspectionRecord[];
  pins: AiPin[];
  progress: SiteProgress;
}

/* ------------------------------------------------------------------ *
 * 構築
 * ------------------------------------------------------------------ */

/** 工種ごとの構造特性 */
function structureProfile(project: Project) {
  const isArch = project.siteType.startsWith("arch");
  const isUrban = project.siteType.endsWith("urban");
  if (isArch) {
    return {
      floors: Math.max(1, project.visual.floors || (isUrban ? 8 : 3)),
      floorHeight: isUrban ? 3.4 : 3.6,
      baysX: isUrban ? 4 : 3,
      baysZ: isUrban ? 3 : 2,
      columnSize: isUrban ? 0.8 : 0.45,
      beamDepth: isUrban ? 0.9 : 0.5,
      slabThickness: 0.25,
      kind: "building" as const,
    };
  }
  return {
    floors: 0,
    floorHeight: 0,
    baysX: 6,
    baysZ: 2,
    columnSize: 0.5,
    beamDepth: 0.6,
    slabThickness: 0.35,
    kind: "civil" as const,
  };
}

const PROGRESS_PHASE_TEMPLATE = [
  { id: "prep", label: "仮設・準備", color: "#8a8f98" },
  { id: "earthwork", label: "土工・掘削", color: "#b0885a" },
  { id: "structure", label: "構造物・躯体", color: "#3b7dd8" },
  { id: "finish", label: "仕上げ・舗装", color: "#2f9d6b" },
];

const AI_CATEGORIES = [
  "品質",
  "安全",
  "工程",
  "出来形",
  "環境",
  "仮設",
];

const INSPECTION_TEMPLATE: { label: string; status: InspectionStatus; note: string }[] = [
  { label: "法面の変状", status: "attention", note: "表面に軽微なひび割れを確認。経過観察。" },
  { label: "仮設材の設置状況", status: "ok", note: "基準どおり設置されていることを確認。" },
  { label: "舗装の平坦性", status: "ok", note: "3m プロフィルメータで規格値内。" },
  { label: "標識・保安施設", status: "repair", note: "一部反射板の汚損。清掃・交換が必要。" },
  { label: "排水施設の通水", status: "ok", note: "詰まりなし。通水確認済み。" },
  { label: "構造物の鉄筋かぶり", status: "attention", note: "一部でかぶり不足。是正指示済み。" },
];

/** ISO 日付に日数を加算 */
function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 工期に対する「現在」の位置（0..1） */
function elapsedRatio(project: Project, asOf: string): number {
  const start = Date.parse(project.schedule.startDate);
  const end = Date.parse(project.schedule.plannedEndDate);
  const now = Date.parse(asOf);
  if (!(end > start)) return 0;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

/**
 * 現場ごとの3Dシーンデータを構築する。
 * 同じプロジェクトに対して常に同じ結果を返す（決定的）。
 */
export function buildSiteModelData(project: Project): SiteModelData {
  const rand = makeRandom(hashSeed(project.id));
  const profile = structureProfile(project);

  const width = round(Math.max(24, project.visual.siteWidthM));
  const depth = round(Math.max(18, project.visual.siteDepthM));
  const height = round(profile.floors * profile.floorHeight, 1);
  const halfW = width / 2;
  const halfD = depth / 2;

  /* --- 写真（案件の現場タイプに割り当てられたサンプル写真を巡回使用） --- */
  const photoPool = PHOTO_FILES[project.siteType] ?? PHOTO_FILES["civil-urban"];
  const photoAt = (i: number) => photoPool[i % photoPool.length];

  /* --- 撮影位置（敷地を囲むように配置） --- */
  const captureCount = 6;
  const captures: CaptureShot[] = [];
  for (let i = 0; i < captureCount; i++) {
    const angle = (i / captureCount) * Math.PI * 2 + rand() * 0.25;
    const radius = Math.max(halfW, halfD) * (1.18 + rand() * 0.22);
    const px = round(Math.cos(angle) * radius, 2);
    const pz = round(Math.sin(angle) * radius, 2);
    const py = round(profile.kind === "building" ? 1.6 + rand() * 1.2 : 1.5 + rand() * 0.6, 2);
    const kind: CaptureKind = i % 5 === 4 ? "uav" : i % 3 === 1 ? "camera" : "smartphone";
    const photo = photoAt(i);
    const credit = PHOTO_CREDIT[photo];
    captures.push({
      id: `${project.id}-cap-${i + 1}`,
      kind,
      position: [px, kind === "uav" ? round(18 + rand() * 10, 2) : py, pz],
      target: [0, round(height * 0.4, 2), 0],
      photoUrl: photo,
      photoAuthor: credit?.author ?? "不明",
      photoLicense: credit?.license ?? "不明",
      photoSourceUrl: credit?.url ?? "",
      capturedAt: addDays(project.schedule.startDate, Math.round(30 + i * 24)),
      label:
        kind === "uav"
          ? `UAV 空撮 ${i + 1}`
          : kind === "camera"
            ? `全景撮影 ${i + 1}`
            : `スマホ撮影 ${i + 1}`,
    });
  }

  /* --- 撮影軌跡（撮影位置を撮影順に結ぶ） --- */
  const trajectory: [number, number, number][] = captures.map((c) => c.position);

  /* --- 点検記録 --- */
  const inspections: InspectionRecord[] = INSPECTION_TEMPLATE.map((tpl, i) => {
    const t = (i + 1) / (INSPECTION_TEMPLATE.length + 1);
    return {
      id: `${project.id}-insp-${i + 1}`,
      position: [
        round(-halfW + width * t, 2),
        round(profile.kind === "building" ? 1.2 + rand() * 2 : 0.6 + rand() * 0.8, 2),
        round(-halfD + depth * (0.2 + rand() * 0.6), 2),
      ],
      label: tpl.label,
      status: tpl.status,
      inspectedAt: addDays(project.schedule.startDate, 60 + i * 21),
      note: tpl.note,
    };
  });

  /* --- AI・指摘ピン --- */
  const pinCount = 4;
  const pins: AiPin[] = Array.from({ length: pinCount }, (_, i) => {
    const t = (i + 1) / (pinCount + 1);
    const sev: AiPinSeverity = i === 0 ? "warning" : i < 3 ? "notice" : "info";
    return {
      id: `${project.id}-pin-${i + 1}`,
      position: [
        round(-halfW + width * t + (rand() - 0.5) * 6, 2),
        round(profile.kind === "building" ? 1.5 + i * 2.2 : 0.9 + rand() * 1.2, 2),
        round(halfD + 2 + rand() * 3, 2),
      ],
      label: [
        "開口部周りのひび割れ",
        "保安柵の設置不足",
        "資材置場の整理不良",
        "工程遅延の兆候",
      ][i],
      category: AI_CATEGORIES[(hashSeed(project.id) + i) % AI_CATEGORIES.length],
      severity: sev,
      createdAt: addDays(project.schedule.startDate, 45 + i * 17),
    };
  });

  /* --- 施工進捗 --- */
  const asOf = project.schedule.lastUpdatedAt.slice(0, 10);
  const elapsed = elapsedRatio(project, asOf);
  const overall =
    project.status === "completed" ? 1 : project.status === "planned" ? 0 : round(elapsed * 0.96, 3);

  const phases: ProgressPhase[] = PROGRESS_PHASE_TEMPLATE.map((tpl, i) => {
    const spanStart = -halfW + (width / PROGRESS_PHASE_TEMPLATE.length) * i;
    const spanEnd = spanStart + width / PROGRESS_PHASE_TEMPLATE.length;
    // 工程の開始/終了を工期に均等割りし、asOf までにどこまで進んだかを求める
    const segStart = i / PROGRESS_PHASE_TEMPLATE.length;
    const segEnd = (i + 1) / PROGRESS_PHASE_TEMPLATE.length;
    const ratio = Math.min(1, Math.max(0, (elapsed - segStart) / (segEnd - segStart)));
    return {
      id: tpl.id,
      label: tpl.label,
      ratio: round(ratio, 3),
      from: addDays(project.schedule.startDate, Math.round(segStart * 365)),
      to: addDays(project.schedule.startDate, Math.round(segEnd * 365)),
      color: tpl.color,
      span: [round(spanStart, 2), round(spanEnd, 2)],
    };
  });

  return {
    projectId: project.id,
    slug: project.slug,
    width,
    depth,
    height,
    floors: profile.floors,
    bim: {
      baysX: profile.baysX,
      baysZ: profile.baysZ,
      columnSize: profile.columnSize,
      beamDepth: profile.beamDepth,
      slabThickness: profile.slabThickness,
      floorHeight: profile.floorHeight || 3,
    },
    cad: {
      outline: [
        [-halfW, -halfD],
        [halfW, -halfD],
        [halfW, halfD],
        [-halfW, halfD],
        [-halfW, -halfD],
      ],
      centerLines: [
        [
          [-halfW - 6, 0],
          [halfW + 6, 0],
        ],
        [
          [0, -halfD - 6],
          [0, halfD + 6],
        ],
      ],
      gridLines: Array.from({ length: profile.baysX - 1 }, (_, i) => {
        const x = -halfW + (width / profile.baysX) * (i + 1);
        return [
          [round(x, 2), -halfD],
          [round(x, 2), halfD],
        ] as [number, number][];
      }).concat(
        Array.from({ length: profile.baysZ - 1 }, (_, i) => {
          const z = -halfD + (depth / profile.baysZ) * (i + 1);
          return [
            [-halfW, round(z, 2)],
            [halfW, round(z, 2)],
          ] as [number, number][];
        }),
      ),
      offset: round(Math.max(halfW, halfD) * 0.18, 2),
    },
    pointcloud: {
      count: 4000 + Math.floor(rand() * 2000),
      seed: hashSeed(`${project.id}:pc`),
      jitter: 0.35,
    },
    gaussian: {
      count: 900 + Math.floor(rand() * 400),
      seed: hashSeed(`${project.id}:gs`),
      size: round(0.55 + rand() * 0.35, 2),
    },
    captures,
    trajectory,
    inspections,
    pins,
    progress: { overall, asOf, phases },
  };
}

/** レイヤー表示名とデータの対応（UI の注記に使う） */
export const SITE_LAYER_NOTE =
  "BIM・CAD・点群・3DGS・スマホ・点検・撮影軌跡・AI指摘ピン・施工進捗は、実データ未接続のため案件IDから決定的に生成したサンプル（合成）データです。GIS と写真は実データ（写真は Wikimedia Commons 素材）です。";
