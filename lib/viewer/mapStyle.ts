/**
 * FallbackMap（2D フォールバック地図）用の MapLibre スタイル定義。
 *
 * 設計方針（実装契約 §0-4 / AC-016「3D 障害時も 2D で閲覧できる」）:
 *  - **外部タイルサーバ・スプライト・グリフ(glyphs)を一切参照しない。**
 *    `version: 8` のスタイルを background レイヤー + 同一オリジンの GeoJSON
 *    ソースだけで構成するため、ネットワークが遮断されていても必ず描画できる。
 *  - 色は `app/globals.css` のデザイントークン、および凍結済みの
 *    `lib/store/useAppStore.ts` の `LAYERS[].swatch` に一致させる。
 *    MapLibre は CSS 変数を解決できないため、ここで具体値として定義する。
 *  - データ本体は `public/data/geo/all/*.geojson`（`npm run export:data` の生成物）。
 *    スタイル側では空の FeatureCollection を入れておき、FallbackMap が
 *    fetch 後に `GeoJSONSource.setData()` で差し替える。
 *    こうすることで「データ取得に失敗しても地図そのものは必ず表示される」。
 */
import type { MapOptions } from "maplibre-gl";

import { publicProjects } from "@/lib/data/projects";
import { SCENE_ORIGIN } from "@/lib/geo/transform";
import type { FeatureCollection } from "@/lib/geo/geojson";
import type { LayerId } from "@/lib/store/useAppStore";

/**
 * MapLibre の `StyleSpecification`。
 * maplibre-gl 6 はスタイル仕様の型を再輸出していないため、
 * 凍結インターフェースである `MapOptions["style"]` から導出する。
 */
export type MapStyleSpec = Exclude<MapOptions["style"], string | undefined | null>;

/**
 * レイヤーの `filter` 式（`setFilter` の引数型から導出）。
 * maplibre-gl 6 は FilterSpecification を再輸出しないため、この形で取得する。
 */
export type MapLayerFilter = Parameters<import("maplibre-gl").Map["setFilter"]>[1];

/* ------------------------------------------------------------------ *
 * 色（globals.css のトークン / LAYERS.swatch に一致）
 * ------------------------------------------------------------------ */

export const MAP_COLORS = {
  /** --bg oklch(97.5% 0.005 250) */
  background: "#f4f7fa",
  /** 地形・地盤レイヤーの淡い下地（--st-done 系 oklch(96.5% 0.02 150)） */
  terrain: "#ebf8ec",
  /** 基盤グリッド（--border-strong 相当をやや濃く oklch(87% 0.01 240)） */
  grid: "#cfd5da",

  /* --- データレイヤー（LAYERS[].swatch と同値） --- */
  /** LAYERS.workzone / --st-planned 系 */
  workzone: "#3b7dd8",
  /** LAYERS.markers */
  marker: "#2f9d6b",
  /** LAYERS.regulation / --st-reg */
  regulation: "#d23b2e",
  /** LAYERS.detour / --st-detour */
  detour: "#35a3c4",
  /** LAYERS.pedestrian / --st-night */
  pedestrian: "#7a53c9",
  /** LAYERS.completion（2D では凡例のみ） */
  completion: "#e08a2e",

  /* --- 施工状態（globals.css のステータストークン） --- */
  /** --st-active */
  statusActive: "#e58212",
  /** --st-planned */
  statusPlanned: "#2b7ec9",
  /** --st-done */
  statusDone: "#249057",
  /** --st-hold */
  statusHold: "#7b8187",

  /* --- 選択強調 --- */
  /** --fg: 選択中の工区を最も強いコントラストで縁取る */
  selection: "#121c23",
  /** --surface: 選択線の下に敷く白い縁取り */
  selectionCasing: "#ffffff",
} as const;

/* ------------------------------------------------------------------ *
 * スタイル要素の識別子
 * ------------------------------------------------------------------ */

export const MAP_SOURCE_IDS = {
  grid: "cm-grid",
  workzone: "cm-workzone",
  regulation: "cm-regulation",
  detour: "cm-detour",
  pedestrian: "cm-pedestrian",
  centers: "cm-centers",
} as const;

export const MAP_LAYERS = {
  background: "cm-background",
  terrain: "cm-terrain",
  grid: "cm-grid-line",
  workzoneFill: "cm-workzone-fill",
  workzoneLine: "cm-workzone-line",
  regulationLine: "cm-regulation-line",
  detourLine: "cm-detour-line",
  pedestrianLine: "cm-pedestrian-line",
  centersHalo: "cm-centers-halo",
  centersCircle: "cm-centers-circle",
  selectedFill: "cm-workzone-selected-fill",
  selectedCasing: "cm-workzone-selected-casing",
  selectedLine: "cm-workzone-selected-line",
} as const;

/** 選択なしを表す番兵。GeoJSON の projectId と絶対に衝突しない値を使う。 */
export const NO_SELECTION_ID = "__none__";

/* ------------------------------------------------------------------ *
 * ローカル GeoJSON ソース（public/data/geo/all/*.geojson）
 * ------------------------------------------------------------------ */

export interface MapDataSource {
  /** MapLibre のソース id */
  id: string;
  /** 同一オリジンのローカルファイル */
  url: string;
  /** このソースを制御するストアのレイヤー */
  storeLayer: LayerId;
  /** 日本語ラベル（取得失敗時の通知に使う） */
  label: string;
}

export const MAP_GEOJSON_SOURCES: MapDataSource[] = [
  {
    id: MAP_SOURCE_IDS.workzone,
    url: "/data/geo/all/workzone.geojson",
    storeLayer: "workzone",
    label: "工区",
  },
  {
    id: MAP_SOURCE_IDS.regulation,
    url: "/data/geo/all/regulation.geojson",
    storeLayer: "regulation",
    label: "車線規制",
  },
  {
    id: MAP_SOURCE_IDS.detour,
    url: "/data/geo/all/detour.geojson",
    storeLayer: "detour",
    label: "迂回路",
  },
  {
    id: MAP_SOURCE_IDS.pedestrian,
    url: "/data/geo/all/pedestrian.geojson",
    storeLayer: "pedestrian",
    label: "歩道切替",
  },
  {
    id: MAP_SOURCE_IDS.centers,
    url: "/data/geo/all/centers.geojson",
    storeLayer: "markers",
    label: "工事位置",
  },
];

/**
 * ストアの `visibleLayers` → MapLibre レイヤー id の対応。
 * `city` / `terrain` は 3D 専用（LAYERS.threeOnly）だが、2D でも
 * ローカル生成の基盤表現（グリッド / 地盤の色）として意味を持たせる。
 * `completion` は 3D のモデルのみなので 2D では制御対象を持たない。
 */
export const STORE_LAYER_TO_MAP_LAYERS: Record<LayerId, readonly string[]> = {
  city: [MAP_LAYERS.grid],
  terrain: [MAP_LAYERS.terrain],
  workzone: [
    MAP_LAYERS.workzoneFill,
    MAP_LAYERS.workzoneLine,
    MAP_LAYERS.selectedFill,
    MAP_LAYERS.selectedCasing,
    MAP_LAYERS.selectedLine,
  ],
  markers: [MAP_LAYERS.centersHalo, MAP_LAYERS.centersCircle],
  completion: [],
  regulation: [MAP_LAYERS.regulationLine],
  detour: [MAP_LAYERS.detourLine],
  pedestrian: [MAP_LAYERS.pedestrianLine],
};

/** クリックで工事を選択できるレイヤー（上にあるものから判定される） */
export const MAP_CLICK_LAYERS: readonly string[] = [
  MAP_LAYERS.centersCircle,
  MAP_LAYERS.workzoneFill,
];

/** 初期表示（データが空のときのフォールバック） */
export const MAP_INITIAL_VIEW = {
  center: [SCENE_ORIGIN.longitude, SCENE_ORIGIN.latitude] as [number, number],
  zoom: 14.6,
};

/** 全案件を含むようにカメラを合わせるときの余白(px) */
export const MAP_FIT_PADDING = 72;

/* ------------------------------------------------------------------ *
 * ローカル生成の基盤グリッド（タイルサーバ代替）
 * ------------------------------------------------------------------ */

function emptyFeatureCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

/** 全公開案件の中心を含む範囲（余白付き） */
function dataExtent(): [number, number, number, number] {
  const projects = publicProjects();
  if (projects.length === 0) {
    const pad = 0.008;
    return [
      SCENE_ORIGIN.longitude - pad,
      SCENE_ORIGIN.latitude - pad,
      SCENE_ORIGIN.longitude + pad,
      SCENE_ORIGIN.latitude + pad,
    ];
  }
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const p of projects) {
    const { longitude, latitude } = p.location.center;
    if (longitude < minLon) minLon = longitude;
    if (longitude > maxLon) maxLon = longitude;
    if (latitude < minLat) minLat = latitude;
    if (latitude > maxLat) maxLat = latitude;
  }
  return [minLon, minLat, maxLon, maxLat];
}

const GRID_STEPS = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5] as const;

/** 表示範囲におさまる見やすい刻み幅を選ぶ */
export function chooseGridStep(span: number): number {
  const target = span / 12;
  for (const step of GRID_STEPS) {
    if (step >= target) return step;
  }
  return GRID_STEPS[GRID_STEPS.length - 1];
}

/**
 * 基盤グリッド（経緯線）。外部の道路タイルが無くても
 * 「地図らしい座標の手がかり」を出すためのローカル生成物。
 */
export function buildGraticule(): FeatureCollection {
  const [minLon, minLat, maxLon, maxLat] = dataExtent();
  const step = chooseGridStep(Math.max(maxLon - minLon, maxLat - minLat));
  const pad = step * 2;
  const west = Math.floor((minLon - pad) / step) * step;
  const east = Math.ceil((maxLon + pad) / step) * step;
  const south = Math.floor((minLat - pad) / step) * step;
  const north = Math.ceil((maxLat + pad) / step) * step;

  const features: FeatureCollection["features"] = [];
  const limit = 80; // 念のため無限ループ・過剰生成を防ぐ

  for (let i = 0, lon = west; lon <= east && i < limit; i += 1, lon = west + i * step) {
    const value = Number(lon.toFixed(6));
    features.push({
      type: "Feature",
      id: `grid-lon-${value}`,
      geometry: {
        type: "LineString",
        coordinates: [
          [value, south],
          [value, north],
        ],
      },
      properties: {
        id: `grid-lon-${value}`,
        projectId: "",
        type: "grid",
        name: `経線 ${value.toFixed(3)}`,
      },
    });
  }

  for (let i = 0, lat = south; lat <= north && i < limit; i += 1, lat = south + i * step) {
    const value = Number(lat.toFixed(6));
    features.push({
      type: "Feature",
      id: `grid-lat-${value}`,
      geometry: {
        type: "LineString",
        coordinates: [
          [west, value],
          [east, value],
        ],
      },
      properties: {
        id: `grid-lat-${value}`,
        projectId: "",
        type: "grid",
        name: `緯線 ${value.toFixed(3)}`,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/* ------------------------------------------------------------------ *
 * スタイル本体
 * ------------------------------------------------------------------ */

/**
 * 外部リソースを一切参照しない MapLibre スタイルを生成する。
 * 呼び出しのたびに新しいオブジェクトを返す（MapLibre が内部で破壊的に
 * 扱う可能性があるため、モジュール定数の共有は避ける）。
 */
export function buildMapStyle(): MapStyleSpec {
  const empty = emptyFeatureCollection();
  const noSelection: MapLayerFilter = ["==", ["get", "projectId"], NO_SELECTION_ID];

  return {
    version: 8,
    name: "工事みえるマップ 2D（ローカル定義・外部タイル不要）",
    // スプライト/グリフは指定しない（symbol レイヤーを使わないため不要）
    sources: {
      [MAP_SOURCE_IDS.grid]: { type: "geojson", data: buildGraticule() },
      [MAP_SOURCE_IDS.workzone]: { type: "geojson", data: empty },
      [MAP_SOURCE_IDS.regulation]: { type: "geojson", data: empty },
      [MAP_SOURCE_IDS.detour]: { type: "geojson", data: empty },
      [MAP_SOURCE_IDS.pedestrian]: { type: "geojson", data: empty },
      [MAP_SOURCE_IDS.centers]: { type: "geojson", data: empty },
    },
    layers: [
      {
        id: MAP_LAYERS.background,
        type: "background",
        paint: { "background-color": MAP_COLORS.background },
      },
      {
        id: MAP_LAYERS.terrain,
        type: "background",
        paint: {
          "background-color": MAP_COLORS.terrain,
          "background-opacity": 0.9,
        },
      },
      {
        id: MAP_LAYERS.grid,
        type: "line",
        source: MAP_SOURCE_IDS.grid,
        paint: {
          "line-color": MAP_COLORS.grid,
          "line-width": 0.7,
          "line-opacity": 0.85,
        },
      },
      {
        id: MAP_LAYERS.workzoneFill,
        type: "fill",
        source: MAP_SOURCE_IDS.workzone,
        paint: {
          "fill-color": MAP_COLORS.workzone,
          "fill-opacity": 0.24,
        },
      },
      {
        id: MAP_LAYERS.workzoneLine,
        type: "line",
        source: MAP_SOURCE_IDS.workzone,
        paint: {
          "line-color": MAP_COLORS.workzone,
          "line-width": 1.2,
          "line-opacity": 0.9,
        },
      },
      {
        id: MAP_LAYERS.regulationLine,
        type: "line",
        source: MAP_SOURCE_IDS.regulation,
        paint: {
          "line-color": MAP_COLORS.regulation,
          "line-width": 2.4,
          "line-opacity": 0.95,
        },
      },
      {
        id: MAP_LAYERS.detourLine,
        type: "line",
        source: MAP_SOURCE_IDS.detour,
        paint: {
          "line-color": MAP_COLORS.detour,
          "line-width": 2.4,
          "line-dasharray": [2, 1.6],
        },
      },
      {
        id: MAP_LAYERS.pedestrianLine,
        type: "line",
        source: MAP_SOURCE_IDS.pedestrian,
        paint: {
          "line-color": MAP_COLORS.pedestrian,
          "line-width": 2,
          "line-opacity": 0.9,
        },
      },
      {
        id: MAP_LAYERS.centersHalo,
        type: "circle",
        source: MAP_SOURCE_IDS.centers,
        paint: {
          "circle-radius": 11,
          "circle-color": MAP_COLORS.marker,
          "circle-opacity": 0.18,
        },
      },
      {
        id: MAP_LAYERS.centersCircle,
        type: "circle",
        source: MAP_SOURCE_IDS.centers,
        paint: {
          "circle-radius": 6,
          "circle-color": MAP_COLORS.marker,
          "circle-stroke-color": MAP_COLORS.selectionCasing,
          "circle-stroke-width": 2,
        },
      },
      {
        id: MAP_LAYERS.selectedFill,
        type: "fill",
        source: MAP_SOURCE_IDS.workzone,
        filter: noSelection,
        paint: {
          "fill-color": MAP_COLORS.workzone,
          "fill-opacity": 0.5,
        },
      },
      {
        id: MAP_LAYERS.selectedCasing,
        type: "line",
        source: MAP_SOURCE_IDS.workzone,
        filter: noSelection,
        paint: {
          "line-color": MAP_COLORS.selectionCasing,
          "line-width": 6.5,
          "line-opacity": 0.9,
        },
      },
      {
        id: MAP_LAYERS.selectedLine,
        type: "line",
        source: MAP_SOURCE_IDS.workzone,
        filter: noSelection,
        paint: {
          "line-color": MAP_COLORS.selection,
          "line-width": 3,
        },
      },
    ],
  };
}
