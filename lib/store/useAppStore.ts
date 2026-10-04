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
