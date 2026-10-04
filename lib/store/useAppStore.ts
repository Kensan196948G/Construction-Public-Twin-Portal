/**
 * UI 状態管理 (Zustand)。
 *
 * 仕様書 #15 UI状態 の項目をすべて保持する。
 * サーバー/クライアントで同一の初期値を返すため、初期 viewTime は
 * サンプルデータの基準日（2026-10-04）に固定する（hydration mismatch 回避）。
 */
"use client";

import { create } from "zustand";
import type { ProjectCategory, ProjectStatus } from "@/lib/schemas/project";
import type { ImpactType } from "@/lib/schemas/impact";
import { TIMELINE_START, TIMELINE_DAYS, TIMELINE_TODAY_INDEX } from "@/lib/data/source";

/* ------------------------------------------------------------------ *
 * 時間軸
 * ------------------------------------------------------------------ */

export const TIMELINE_BASE = new Date(`${TIMELINE_START}T00:00:00+09:00`);

/** タイムラインのインデックスから実日時を得る */
export function timelineIndexToDate(index: number): Date {
  const d = new Date(TIMELINE_BASE.getTime());
  d.setDate(d.getDate() + index);
  return d;
}

export function dateToTimelineIndex(date: Date): number {
  const diff = date.getTime() - TIMELINE_BASE.getTime();
  return Math.round(diff / 86_400_000);
}

export const TIMELINE_MIN = 0;
export const TIMELINE_MAX = TIMELINE_DAYS - 1;
/** 初期表示 = 「現在」 */
export const DEFAULT_TIMELINE_INDEX = TIMELINE_TODAY_INDEX;

/* ------------------------------------------------------------------ *
 * レイヤー
 * ------------------------------------------------------------------ */

export const LAYER_IDS = [
  "city",
  "terrain",
  "workzone",
  "markers",
  "completion",
  "regulation",
  "detour",
  "pedestrian",
] as const;

export type LayerId = (typeof LAYER_IDS)[number];

export interface LayerMeta {
  id: LayerId;
  name: string;
  group: "base" | "project" | "impact";
  /** 凡例・スウォッチ用の色 */
  swatch: string;
  /** 描画タイプ（凡例の見た目） */
  render: "area" | "line" | "line-dashed" | "point" | "model";
  /** 3D でのみ意味を持つレイヤー */
  threeOnly?: boolean;
}

export const LAYER_GROUPS: Record<LayerMeta["group"], string> = {
  base: "Base Layer",
  project: "Project Layer",
  impact: "Impact Layer",
};

export const LAYERS: LayerMeta[] = [
  { id: "city", name: "都市モデル", group: "base", swatch: "#cfd3da", render: "area", threeOnly: true },
  { id: "terrain", name: "地形・地盤", group: "base", swatch: "#8fb98a", render: "area", threeOnly: true },
  { id: "workzone", name: "工区", group: "project", swatch: "#3b7dd8", render: "area" },
  { id: "markers", name: "工事位置", group: "project", swatch: "#2f9d6b", render: "point" },
  { id: "completion", name: "完成予想", group: "project", swatch: "#e08a2e", render: "model" },
  { id: "regulation", name: "車線規制・通行止め", group: "impact", swatch: "#d23b2e", render: "line" },
  { id: "detour", name: "迂回路", group: "impact", swatch: "#35a3c4", render: "line-dashed" },
  { id: "pedestrian", name: "歩道切替", group: "impact", swatch: "#7a53c9", render: "line" },
];

export const DEFAULT_VISIBLE_LAYERS: Record<LayerId, boolean> = {
  city: true,
  terrain: true,
  workzone: true,
  markers: true,
  completion: true,
  regulation: true,
  detour: true,
  pedestrian: true,
};

/* ------------------------------------------------------------------ *
 * データレイヤー（現場ごとの3Dで扱う情報ソース）
 *
 * 建設デジタルツインで扱うデータ種別。GIS は既存の
 * 工区・規制・迂回路・歩道切替レイヤーをまとめて制御する。
 *
 * 注意: 本 MVP には実データが無いため、各レイヤーの形状は
 * `lib/site/sceneData.ts` がプロジェクトIDから決定的に生成する
 * **サンプル（合成）データ**である。UI 上でその旨を明示すること。
 * ------------------------------------------------------------------ */

export const DATA_LAYER_IDS = [
  "bim",
  "cad",
  "gis",
  "pointcloud",
  "gaussian",
  "smartphone",
  "photo",
  "progress",
  "inspection",
  "trajectory",
  "aiPin",
] as const;

export type DataLayerId = (typeof DATA_LAYER_IDS)[number];

export interface DataLayerMeta {
  id: DataLayerId;
  /** 表示名（UI のラベルと一致させる） */
  name: string;
  /** 補足説明（1行） */
  description: string;
  /** 3D での描画プリミティブ（凡例のマーク形状） */
  render: "mesh" | "line" | "line-dashed" | "points" | "splat" | "point" | "billboard" | "pin";
  /** 凡例・スウォッチ色 */
  swatch: string;
  /** このレイヤーの元データが合成サンプルであるか */
  sample: boolean;
}

export const DATA_LAYERS: DataLayerMeta[] = [
  {
    id: "bim",
    name: "BIM",
    description: "構造部材（柱・梁・床）の3Dモデル",
    render: "mesh",
    swatch: "#5b7cfa",
    sample: true,
  },
  {
    id: "cad",
    name: "CAD",
    description: "平面図・中心線・寸法のオーバーレイ",
    render: "line",
    swatch: "#e58212",
    sample: true,
  },
  {
    id: "gis",
    name: "GIS",
    description: "工区・交通規制・迂回路・歩道切替",
    render: "mesh",
    swatch: "#3b7dd8",
    sample: false,
  },
  {
    id: "pointcloud",
    name: "点群",
    description: "レーザースキャンによる点群",
    render: "points",
    swatch: "#3fb6a8",
    sample: true,
  },
  {
    id: "gaussian",
    name: "3DGS",
    description: "3Dガウシアンスプラッティング",
    render: "splat",
    swatch: "#b06ae0",
    sample: true,
  },
  {
    id: "smartphone",
    name: "スマホ",
    description: "スマートフォン撮影位置",
    render: "point",
    swatch: "#2f9d6b",
    sample: true,
  },
  {
    id: "photo",
    name: "写真",
    description: "撮影位置に貼る現場写真パネル",
    render: "billboard",
    swatch: "#d9a441",
    sample: false,
  },
  {
    id: "progress",
    name: "施工進捗",
    description: "工程ごとの進捗率を色で表現",
    render: "mesh",
    swatch: "#35a3c4",
    sample: true,
  },
  {
    id: "inspection",
    name: "点検",
    description: "点検記録と判定（良・要注意・要補修）",
    render: "pin",
    swatch: "#7a53c9",
    sample: true,
  },
  {
    id: "trajectory",
    name: "撮影軌跡",
    description: "撮影位置を結ぶ移動軌跡",
    render: "line-dashed",
    swatch: "#d23b2e",
    sample: true,
  },
  {
    id: "aiPin",
    name: "AI・指摘ピン",
    description: "AI検出・指摘事項の位置ピン",
    render: "pin",
    swatch: "#e0457b",
    sample: true,
  },
];

export const DEFAULT_DATA_LAYERS: Record<DataLayerId, boolean> = {
  bim: false,
  cad: false,
  gis: true,
  pointcloud: false,
  gaussian: false,
  smartphone: false,
  photo: true,
  progress: false,
  inspection: false,
  trajectory: false,
  aiPin: false,
};

/* ------------------------------------------------------------------ *
 * 表示スコープ
 * ------------------------------------------------------------------ */

/**
 * 3D の表示スコープ。
 *   site … 選択した1現場だけを描画する（既定。現場ごとの3D）
 *   area … 地区全体の工区を俯瞰する（一覧性のため残す）
 */
export type ViewScope = "site" | "area";
export const DEFAULT_VIEW_SCOPE: ViewScope = "site";

/* ------------------------------------------------------------------ *
 * 表示モード
 * ------------------------------------------------------------------ */

export type ViewMode = "3d" | "2d";
/** 3D 背景の供給元。local = MVP 用手続き生成都市、plateau = 外部 3D Tiles */
export type Base3dSource = "local" | "plateau";

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export interface AppState {
  /* 仕様書 #15 の必須状態 */
  selectedProjectId: string | null;
  searchKeyword: string;
  selectedCategory: ProjectCategory | null;
  selectedStatus: ProjectStatus | null;
  viewMode: ViewMode;
  viewTime: string;
  visibleLayers: Record<LayerId, boolean>;
  selectedImpactId: string | null;

  /* 補助状態 */
  regulatingOnly: boolean;
  /** 3D の表示スコープ（現場ごと / 地区全体） */
  viewScope: ViewScope;
  /** データレイヤーの表示状態 */
  dataLayers: Record<DataLayerId, boolean>;
  /** 一覧タブ: 工事 / レイヤー / 凡例 */
  sidebarTab: SidebarTab;
  /** 一覧から開く「現場ビューア」 */
  siteViewerOpen: boolean;
  siteViewerIndex: number;
  completionMode: CompletionMode;
  base3dSource: Base3dSource;
  mobileSheetOpen: boolean;
  toast: { id: number; message: string } | null;

  /* アクション */
  selectProject: (id: string | null) => void;
  setSearchKeyword: (keyword: string) => void;
  setCategory: (category: ProjectCategory | null) => void;
  setStatus: (status: ProjectStatus | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setViewTime: (iso: string) => void;
  setTimelineIndex: (index: number) => void;
  toggleLayer: (id: LayerId) => void;
  setLayerVisible: (id: LayerId, visible: boolean) => void;
  setAllLayers: (visible: boolean) => void;
  selectImpact: (id: string | null) => void;
  setRegulatingOnly: (value: boolean) => void;
  setViewScope: (scope: ViewScope) => void;
  toggleDataLayer: (id: DataLayerId) => void;
  setDataLayerVisible: (id: DataLayerId, visible: boolean) => void;
  setAllDataLayers: (visible: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  openSiteViewer: (index?: number) => void;
  closeSiteViewer: () => void;
  setSiteViewerIndex: (index: number) => void;
  setCompletionMode: (mode: CompletionMode) => void;
  setBase3dSource: (source: Base3dSource) => void;
  setMobileSheetOpen: (open: boolean) => void;
  showToast: (message: string) => void;
  clearToast: () => void;
}

export type SidebarTab = "projects" | "layers";
export type CompletionMode = "current" | "planned" | "compare";

export const useAppStore = create<AppState>((set) => ({
  // 初期表示はプロトタイプ（デザインの正）と同じ案件を選択状態にする
  selectedProjectId: "tokyo-demo-002",
  searchKeyword: "",
  selectedCategory: null,
  selectedStatus: null,
  viewMode: "3d",
  viewTime: timelineIndexToDate(DEFAULT_TIMELINE_INDEX).toISOString(),
  visibleLayers: { ...DEFAULT_VISIBLE_LAYERS },
  selectedImpactId: null,

  regulatingOnly: false,
  viewScope: DEFAULT_VIEW_SCOPE,
  dataLayers: { ...DEFAULT_DATA_LAYERS },
  sidebarTab: "projects",
  siteViewerOpen: false,
  siteViewerIndex: 0,
  completionMode: "current",
  base3dSource: "local",
  mobileSheetOpen: false,
  toast: null,

  selectProject: (id) =>
    set((s) => ({
      selectedProjectId: id,
      selectedImpactId: null,
      siteViewerIndex:
        id === null
          ? s.siteViewerIndex
          : Math.max(0, s.siteViewerIndex),
    })),

  setSearchKeyword: (keyword) => set({ searchKeyword: keyword }),
  setCategory: (category) => set({ selectedCategory: category }),
  setStatus: (status) => set({ selectedStatus: status }),
  setViewMode: (viewMode) => set({ viewMode }),
  setViewTime: (viewTime) => set({ viewTime }),

  setTimelineIndex: (index) => {
    const clamped = Math.min(TIMELINE_MAX, Math.max(TIMELINE_MIN, Math.round(index)));
    set({ viewTime: timelineIndexToDate(clamped).toISOString() });
  },

  toggleLayer: (id) =>
    set((s) => ({ visibleLayers: { ...s.visibleLayers, [id]: !s.visibleLayers[id] } })),

  setLayerVisible: (id, visible) =>
    set((s) => ({ visibleLayers: { ...s.visibleLayers, [id]: visible } })),

  setAllLayers: (visible) =>
    set(() => ({
      visibleLayers: LAYER_IDS.reduce(
        (acc, id) => ({ ...acc, [id]: visible }),
        {} as Record<LayerId, boolean>,
      ),
    })),

  selectImpact: (selectedImpactId) => set({ selectedImpactId }),
  setRegulatingOnly: (regulatingOnly) => set({ regulatingOnly }),
  setViewScope: (viewScope) => set({ viewScope }),

  toggleDataLayer: (id) =>
    set((s) => ({ dataLayers: { ...s.dataLayers, [id]: !s.dataLayers[id] } })),

  setDataLayerVisible: (id, visible) =>
    set((s) => ({ dataLayers: { ...s.dataLayers, [id]: visible } })),

  setAllDataLayers: (visible) =>
    set(() => ({
      dataLayers: DATA_LAYER_IDS.reduce(
        (acc, id) => ({ ...acc, [id]: visible }),
        {} as Record<DataLayerId, boolean>,
      ),
    })),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  openSiteViewer: (index) =>
    set((s) => ({ siteViewerOpen: true, siteViewerIndex: index ?? s.siteViewerIndex })),
  closeSiteViewer: () => set({ siteViewerOpen: false }),
  setSiteViewerIndex: (siteViewerIndex) => set({ siteViewerIndex }),
  setCompletionMode: (completionMode) => set({ completionMode }),
  setBase3dSource: (base3dSource) => set({ base3dSource }),
  setMobileSheetOpen: (mobileSheetOpen) => set({ mobileSheetOpen }),

  showToast: (message) => set({ toast: { id: Date.now(), message } }),
  clearToast: () => set({ toast: null }),
}));

/* ------------------------------------------------------------------ *
 * 派生セレクタ
 * ------------------------------------------------------------------ */

/** 検索・フィルタ条件を含む構造（絞り込みは lib/data 側で実行する） */
export interface FilterState {
  keyword: string;
  category: ProjectCategory | null;
  status: ProjectStatus | null;
  regulatingOnly: boolean;
  viewTime: string;
  selectedImpactType?: ImpactType | null;
}
