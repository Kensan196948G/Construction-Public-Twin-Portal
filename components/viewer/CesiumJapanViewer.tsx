"use client";

/**
 * CesiumJS による 3D ビューア（本ポータルの主題ビューア）。
 *
 * 役割:
 *   日本3Dビル相当の 3D 建物 + 公的タイル（地理院タイル）+ 地形（PLATEAU-Terrain）を背景に、
 *   自社の施工範囲（工区・規制・迂回路・歩道切替）を重ねて表示する。
 *
 * 方針（docs/CONTRACTS.md §0）:
 *   - 外部ネットワークが無くても主要機能（工事情報・施工範囲）が動くこと。
 *   - 例外を投げない。初期化に失敗したら内蔵 Three.js ビューアへ自動フォールバックする。
 *   - **表示できていないものを「表示中」と書かない。** どの供給元が実際に載ったかを画面に出す。
 *
 * Cesium の静的アセット（Workers / Assets / Widgets）は `scripts/copy-cesium.mjs` が
 * `public/cesium` へ複製し、`window.CESIUM_BASE_URL = "/cesium"` で参照する。
 * Next.js 16 は Turbopack が既定で webpack プラグインが使えないため、
 * バンドラ設定ではなくスクリプトで複製している。
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

// Cesium のウィジェット CSS。Turbopack でも解決できるよう、
// public/cesium の複製ではなくパッケージから直接 import する。
import "cesium/Build/Cesium/Widgets/widgets.css";

import { publicImpacts } from "@/lib/data/impacts";
import { getProjectById, publicProjects } from "@/lib/data/projects";
import { IMPACT_TYPE_LABEL, isImpactActiveAt, type Impact } from "@/lib/schemas/impact";
import { LAYERS, useAppStore, type LayerId } from "@/lib/store/useAppStore";
import {
  CESIUM_ATTRIBUTION,
  CESIUM_CAMERA,
  CESIUM_HOME,
  CESIUM_LOAD_TIMEOUT_MS,
  GSI_TILES,
  ION_ASSETS,
  PLATEAU_TERRAIN_URL,
  planBuildings,
  readViewerEnvironment,
  type GsiTileId,
} from "@/lib/viewer/cesiumConfig";

import styles from "./CesiumJapanViewer.module.css";

/* Cesium の静的アセットの取得先。バンドラの DefinePlugin が使えないため手動で設定する。 */
if (typeof window !== "undefined") {
  (window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = "/cesium";
}

type CesiumNamespace = typeof import("cesium");
type CesiumViewer = import("cesium").Viewer;
type CesiumDataSource = import("cesium").GeoJsonDataSource;
type CesiumTileset = import("cesium").Cesium3DTileset;

/** 施工範囲オーバーレイの種類と取得先 */
const OVERLAY_SOURCES: { kind: LayerId; path: string }[] = [
  { kind: "workzone", path: "/data/geo/all/workzone.geojson" },
  { kind: "regulation", path: "/data/geo/all/regulation.geojson" },
  { kind: "detour", path: "/data/geo/all/detour.geojson" },
  { kind: "pedestrian", path: "/data/geo/all/pedestrian.geojson" },
  { kind: "markers", path: "/data/geo/all/centers.geojson" },
];

/**
 * スウォッチ色とレイヤー名は `lib/store/useAppStore.ts` の LAYERS から読む
 * （独自の hex を増やさない。LAYERS は全 LayerId を網羅する凍結定数）。
 */
const LAYER_SWATCHES: Record<LayerId, string> = LAYERS.reduce(
  (acc, layer) => ({ ...acc, [layer.id]: layer.swatch }),
  {} as Record<LayerId, string>,
);

const LAYER_LABELS: Record<LayerId, string> = LAYERS.reduce(
  (acc, layer) => ({ ...acc, [layer.id]: layer.name }),
  {} as Record<LayerId, string>,
);

function swatchOf(kind: LayerId): string {
  return LAYER_SWATCHES[kind];
}

function labelOf(kind: LayerId): string {
  return LAYER_LABELS[kind];
}

/**
 * `/data/impacts/index.json` の1件が Impact として扱えるかを検証する。
 * 検証に通らない項目は捨て、同梱データ（publicImpacts）で表示を継続する。
 */
function isImpactRecord(value: unknown): value is Impact {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Impact>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.projectId === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.activeFrom === "string" &&
    typeof candidate.activeTo === "string"
  );
}

/** 3D建物の供給元が変わったかを判定するキー */
function planKey(plan: { source: string; url: string; ionAssetId: number | null }): string {
  return `${plan.source}:${plan.ionAssetId ?? ""}:${plan.url}`;
}

/* ------------------------------------------------------------------ *
 * CesiumJS の読み込み
 *
 * なぜ npm パッケージを import しないのか:
 *   CesiumJS は WASM を **タグ付きテンプレート**（`\0asm…` という 8 進エスケープを含む）
 *   として埋め込んでいる。タグ付きテンプレートは ES2018 の仕様で
 *   不正なエスケープが許容されるが、**タグが外れると構文エラー**になる。
 *   Turbopack（Next.js 16 の既定バンドラ）はタグ関数をインライン化する際に
 *   タグを落とすため、バンドル後のコードが
 *     SyntaxError: Octal escape sequences are not allowed in template strings.
 *   となり、CesiumJS が起動しない（実測で確認）。
 *
 * 対策:
 *   バンドラを通さず、`scripts/copy-cesium.mjs` が複製した
 *   `public/cesium/Cesium.js`（UMD ビルド）を <script> で読み込み、
 *   グローバルの `window.Cesium` を使う。ブラウザがそのまま解釈するため
 *   タグ付きテンプレートの仕様どおりに動作する。
 *
 * 型は `typeof import("cesium")`（型のみ）で取得するので、
 * ランタイムの依存は増えない。
 * ------------------------------------------------------------------ */

const CESIUM_SCRIPT_URL = "/cesium/Cesium.js";

type CesiumGlobal = typeof globalThis & { Cesium?: CesiumNamespace };

let cesiumLoadPromise: Promise<CesiumNamespace> | null = null;

function loadCesium(): Promise<CesiumNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("CesiumJS はブラウザでのみ読み込めます"));
  }

  const globalObject = window as CesiumGlobal;
  if (globalObject.Cesium) return Promise.resolve(globalObject.Cesium);
  if (cesiumLoadPromise) return cesiumLoadPromise;

  cesiumLoadPromise = new Promise<CesiumNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CESIUM_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const namespace = (window as CesiumGlobal).Cesium;
      if (namespace) resolve(namespace);
      else reject(new Error(`${CESIUM_SCRIPT_URL} に Cesium が見つかりません`));
    };
    script.onerror = () => {
      cesiumLoadPromise = null;
      reject(new Error(`${CESIUM_SCRIPT_URL} の読み込みに失敗しました`));
    };
    document.head.appendChild(script);
  });

  return cesiumLoadPromise;
}

/** タイムアウト付きで Promise を待つ。失敗しても例外を投げず null を返す。 */
async function settle<T>(promise: Promise<T>, label: string): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[cesium] ${label} の読み込みがタイムアウトしました`);
      resolve(null);
    }, CESIUM_LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch (error) {
    console.warn(`[cesium] ${label} の読み込みに失敗しました`, error);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function CesiumJapanViewer(): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const cesiumRef = useRef<CesiumNamespace | null>(null);
  const overlaysRef = useRef<Map<LayerId, CesiumDataSource>>(new Map());
  const buildingsRef = useRef<CesiumTileset | null>(null);
  const terrainRef = useRef<import("cesium").TerrainProvider | null>(null);
  const pinRef = useRef<import("cesium").Entity | null>(null);
  const modelRef = useRef<import("cesium").Entity | null>(null);
  /** 現在読み込んでいる3D建物の供給元キー（作り直しの抑止） */
  const buildingPlanKeyRef = useRef<string | null>(null);

  /** 実際に載った地形の供給元（画面表示用） */
  const [terrainLabel, setTerrainLabel] = useState("未読込");
  /** 実際に読み込めた地形の種別（出典を出し分ける。読めていないものを出典に出さない） */
  const [terrainSource, setTerrainSource] = useState<"none" | "plateau" | "ion">("none");
  /** 実際に載った3D建物の供給元と出典（ライセンス上、必ず表示する） */
  const [loadedBuildings, setLoadedBuildings] = useState<{
    key: string;
    label: string;
    attribution: string | null;
  } | null>(null);

  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [statusText, setStatusText] = useState("3Dベースを初期化しています…");

  const [imagery, setImagery] = useState<GsiTileId>("std");
  /** 施工範囲オーバーレイの読み込み完了回数（読み込み後にカメラと色を確定させる） */
  const [overlayVersion, setOverlayVersion] = useState(0);
  /** 影響イベント。初期値は同梱データ（オフラインでも動く）、起動後に公開 JSON で更新する。 */
  const [impacts, setImpacts] = useState<Impact[]>(() => publicImpacts());

  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const visibleLayers = useAppStore((s) => s.visibleLayers);
  const dataLayers = useAppStore((s) => s.dataLayers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const setLayerVisible = useAppStore((s) => s.setLayerVisible);
  const viewTime = useAppStore((s) => s.viewTime);
  const geocodePin = useAppStore((s) => s.geocodePin);
  const completionMode = useAppStore((s) => s.completionMode);
  const setViewerEngine = useAppStore((s) => s.setViewerEngine);
  const showToast = useAppStore((s) => s.showToast);

  /* ------------------------------------------------------------------ *
   * 表示用の派生値
   * ------------------------------------------------------------------ */
  const selectedProject = selectedProjectId ? getProjectById(selectedProjectId) : undefined;
  const municipality = selectedProject?.location.municipality ?? null;
  const buildingPlan = useMemo(
    () => planBuildings(readViewerEnvironment(), municipality),
    [municipality],
  );
  const buildingPlanKey = planKey(buildingPlan);

  /**
   * 「実際に表示中の3D建物」。
   * 未構成・読込中を state へ書き戻すと effect 内の同期 setState になるため、
   * 供給元の計画と読み込み結果から導出する。
   */
  const buildingsLabel =
    buildingPlan.source === "none"
      ? "読み込みなし（3D建物データ未接続）"
      : loadedBuildings?.key === buildingPlanKey
        ? loadedBuildings.label
        : "読込中…";
  const buildingAttribution =
    buildingPlan.source !== "none" && loadedBuildings?.key === buildingPlanKey
      ? loadedBuildings.attribution
      : null;

  const viewTimeDate = useMemo(() => new Date(viewTime), [viewTime]);
  /** 表示日に有効な影響イベントを持つ案件（期間外のジオメトリは淡色表示にする） */
  const activeProjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const impact of impacts) {
      if (isImpactActiveAt(impact, viewTimeDate)) ids.add(impact.projectId);
    }
    return ids;
  }, [impacts, viewTimeDate]);
  const activeImpactCount = useMemo(
    () => impacts.filter((impact) => isImpactActiveAt(impact, viewTimeDate)).length,
    [impacts, viewTimeDate],
  );
  const inactiveImpactCount = impacts.length - activeImpactCount;
  /** 選択中の案件の影響イベント（有効／期間外をラベルで示す） */
  const selectedImpacts = useMemo(
    () =>
      selectedProjectId
        ? impacts.filter((impact) => impact.projectId === selectedProjectId)
        : [],
    [impacts, selectedProjectId],
  );
  const projectCount = publicProjects().length;

  /* ------------------------------------------------------------------ *
   * 初期化（1回だけ）
   * ------------------------------------------------------------------ */
  useEffect(() => {
    let cancelled = false;
    let viewer: CesiumViewer | null = null;
    // クリーンアップ時に ref.current を読まないよう、Map 自体を捕まえておく
    const overlays = overlaysRef.current;

    async function init(): Promise<void> {
      const container = containerRef.current;
      if (!container) return;

      setStatusText("CesiumJS を読み込んでいます…");
      let Cesium: CesiumNamespace;
      try {
        Cesium = await loadCesium();
      } catch (error) {
        console.warn("[cesium] モジュールの読み込みに失敗しました", error);
        if (!cancelled) {
          setPhase("failed");
          setStatusText("3Dベース（CesiumJS）を読み込めませんでした。");
          setViewerEngine("three");
          showToast("3Dベースを内蔵表示に切り替えました");
        }
        return;
      }
      if (cancelled) return;

      const environment = readViewerEnvironment();
      if (environment.ionToken) {
        Cesium.Ion.defaultAccessToken = environment.ionToken;
      }

      // 背景画像: 地理院タイル（トークン不要）。既定の ion 画像は使わない。
      const gsiProvider = new Cesium.UrlTemplateImageryProvider({
        url: GSI_TILES.std.url,
        maximumLevel: GSI_TILES.std.maximumLevel,
        credit: new Cesium.Credit(CESIUM_ATTRIBUTION.gsi, false),
      });

      try {
        viewer = new Cesium.Viewer(container, {
          baseLayer: false,
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          geocoder: false,
          homeButton: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          // 必要時のみ再描画する（GPU・バッテリー消費を抑える）。
          // 明示的に変更した箇所では scene.requestRender() を呼んで反映させる。
          requestRenderMode: true,
          maximumRenderTimeChange: Infinity,
        });
      } catch (error) {
        console.warn("[cesium] Viewer の初期化に失敗しました", error);
        if (!cancelled) {
          setPhase("failed");
          setStatusText("WebGL を利用できないため 3D を表示できません。");
          setViewerEngine("three");
          showToast("3Dベースを内蔵表示に切り替えました");
        }
        return;
      }

      if (cancelled) {
        viewer.destroy();
        return;
      }

      viewerRef.current = viewer;
      cesiumRef.current = Cesium;
      viewer.imageryLayers.addImageryProvider(gsiProvider);
      viewer.scene.globe.depthTestAgainstTerrain = true;
      viewer.scene.globe.enableLighting = true;
      viewer.scene.globe.dynamicAtmosphereLighting = false;
      viewer.scene.globe.dynamicAtmosphereLightingFromSun = false;

      // Sandcastle の "Japan Buildings" と同じく、常に手前から光を当てて建物を見やすくする
      const cameraLight = new Cesium.DirectionalLight({
        direction: viewer.scene.camera.directionWC,
        intensity: 2.0,
      });
      viewer.scene.light = cameraLight;
      viewer.scene.preRender.addEventListener(() => {
        if (viewer) {
          Cesium.Cartesian3.clone(viewer.scene.camera.directionWC, cameraLight.direction);
        }
      });

      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          CESIUM_HOME.longitude,
          CESIUM_HOME.latitude,
          CESIUM_HOME.heightM,
        ),
      });

      setPhase("ready");
      setStatusText("");

      /* --- 地形（トークン不要の PLATEAU-Terrain を優先） --- */
      const terrainPromise = environment.ionToken
        ? Cesium.CesiumTerrainProvider.fromIonAssetId(ION_ASSETS.japanTerrain)
        : Cesium.CesiumTerrainProvider.fromUrl(PLATEAU_TERRAIN_URL, {
            requestVertexNormals: true,
          });
      const terrain = await settle(terrainPromise, "地形");
      if (cancelled || !viewerRef.current) return;
      if (terrain) {
        terrainRef.current = terrain;
        viewerRef.current.terrainProvider = terrain;
        setTerrainSource(environment.ionToken ? "ion" : "plateau");
        setTerrainLabel(
          environment.ionToken
            ? "Japan Regional Terrain（ion 2767062）"
            : "PLATEAU-Terrain（トークン不要）",
        );
      } else {
        setTerrainSource("none");
        setTerrainLabel("取得できませんでした（楕円体で表示）");
      }

      /* --- 3D建物は「選択中の案件の自治体」に追従させる必要があるため、
             別の effect（下）で読み込む。ここでは何もしない。 --- */

      /* --- 施工範囲オーバーレイ --- */
      for (const source of OVERLAY_SOURCES) {
        if (cancelled || !viewerRef.current) return;
        try {
          const response = await fetch(source.path);
          if (!response.ok) continue;
          const geojson = (await response.json()) as object;
          if (cancelled || !viewerRef.current) return;
          const dataSource = await Cesium.GeoJsonDataSource.load(geojson, {
            clampToGround: true,
            stroke: Cesium.Color.fromCssColorString(swatchOf(source.kind)),
            fill: Cesium.Color.fromCssColorString(swatchOf(source.kind)).withAlpha(0.28),
            strokeWidth: 3,
            markerSize: 28,
            markerColor: Cesium.Color.fromCssColorString(swatchOf(source.kind)),
          });
          if (cancelled || !viewerRef.current) return;
          dataSource.name = labelOf(source.kind);
          overlaysRef.current.set(source.kind, dataSource);
          await viewerRef.current.dataSources.add(dataSource);
          // requestRenderMode のため、読み込み後の再描画を明示的に要求する
          viewerRef.current.scene.requestRender();
        } catch (error) {
          console.warn(`[cesium] ${source.path} の読み込みに失敗しました`, error);
        }
      }
      // オーバーレイが揃ったら、カメラ・淡色表示・凡例を確定させる
      if (!cancelled) setOverlayVersion((version) => version + 1);
    }

    void init();

    return () => {
      cancelled = true;
      overlays.clear();
      buildingPlanKeyRef.current = null;
      buildingsRef.current = null;
      terrainRef.current = null;
      pinRef.current = null;
      modelRef.current = null;
      const current = viewerRef.current;
      viewerRef.current = null;
      cesiumRef.current = null;
      if (current && !current.isDestroyed()) {
        try {
          current.destroy();
        } catch (error) {
          console.warn("[cesium] Viewer の破棄に失敗しました", error);
        }
      }
    };
    // 意図的に初回のみ。選択変更などは下の effect が扱う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------------ *
   * 背景画像の切替
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || phase !== "ready") return;

    const tile = GSI_TILES[imagery];
    const layers = viewer.imageryLayers;
    // 先頭のレイヤーだけを差し替える
    if (layers.length > 0) layers.remove(layers.get(0), true);
    layers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: tile.url,
        maximumLevel: tile.maximumLevel,
        credit: new Cesium.Credit(CESIUM_ATTRIBUTION.gsi, false),
      }),
      // 施工範囲オーバーレイの下に置く
      0,
    );
    viewer.scene.requestRender();
  }, [imagery, phase]);

  /* ------------------------------------------------------------------ *
   * 3D建物（選択中の案件の自治体に追従する）
   *
   * 供給元が変わったときだけ読み直す。読み込みに失敗しても
   * 背景タイルと施工範囲はそのまま表示を継続する。
   * ------------------------------------------------------------------ */
  useEffect(() => {
    if (phase !== "ready") return;

    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || viewer.isDestroyed()) return;

    const plan = buildingPlan;
    const key = buildingPlanKey;

    // 同じ供給元を読み込み済みなら、表示の ON/OFF だけ反映する
    if (buildingPlanKeyRef.current === key) {
      const loaded = buildingsRef.current;
      if (loaded && !loaded.isDestroyed()) {
        loaded.show = visibleLayers.city;
        viewer.scene.requestRender();
      }
      return;
    }
    buildingPlanKeyRef.current = key;

    const previous = buildingsRef.current;
    if (previous) {
      viewer.scene.primitives.remove(previous);
      if (!previous.isDestroyed()) previous.destroy();
      buildingsRef.current = null;
    }

    // 供給元が「なし」の場合は表示は導出値（buildingsLabel）が担当する
    if (plan.source === "none") return;

    let cancelled = false;
    const promise =
      plan.source === "ion" && plan.ionAssetId !== null
        ? Cesium.Cesium3DTileset.fromIonAssetId(plan.ionAssetId)
        : Cesium.Cesium3DTileset.fromUrl(plan.url);

    void settle(promise, "3D建物").then((tileset) => {
      if (cancelled || !tileset) {
        tileset?.destroy();
        if (!cancelled) {
          setLoadedBuildings({
            key,
            label: "取得できませんでした",
            attribution: null,
          });
        }
        return;
      }
      const current = viewerRef.current;
      if (!current || current.isDestroyed()) {
        tileset.destroy();
        return;
      }
      buildingsRef.current = tileset;
      tileset.show = visibleLayers.city;
      current.scene.primitives.add(tileset);
      current.scene.requestRender();
      setLoadedBuildings({
        key,
        label: plan.label,
        attribution:
          plan.source === "ion"
            ? CESIUM_ATTRIBUTION.ionJapanBuildings
            : CESIUM_ATTRIBUTION.plateau,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [buildingPlan, buildingPlanKey, visibleLayers.city, phase]);

  /* ------------------------------------------------------------------ *
   * 地形 ON/OFF
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || phase !== "ready") return;
    viewer.terrainProvider = visibleLayers.terrain
      ? (terrainRef.current ?? new Cesium.EllipsoidTerrainProvider())
      : new Cesium.EllipsoidTerrainProvider();
    viewer.scene.requestRender();
  }, [visibleLayers.terrain, phase]);

  /* ------------------------------------------------------------------ *
   * 施工範囲レイヤーの ON/OFF
   *
   * データレイヤー「GIS」がオフのときは、GIS 由来の施工範囲を一括で隠す
   * （内蔵3Dビューアの挙動と揃える）。
   * ------------------------------------------------------------------ */
  useEffect(() => {
    if (phase !== "ready") return;
    for (const source of OVERLAY_SOURCES) {
      const dataSource = overlaysRef.current.get(source.kind);
      if (!dataSource) continue;
      const gated = source.kind === "markers" ? true : dataLayers.gis;
      dataSource.show = visibleLayers[source.kind] && gated;
    }
    // requestRenderMode のため、表示切替後の再描画を明示的に要求する
    viewerRef.current?.scene.requestRender();
  }, [visibleLayers, dataLayers.gis, phase, overlayVersion]);

  /* ------------------------------------------------------------------ *
   * 影響イベント（公開 JSON）
   *
   * 同一オリジンの `/data/impacts/index.json` を取得する。取得できなければ
   * 同梱データ（publicImpacts）のまま表示を継続する（外部依存で止めない）。
   * ------------------------------------------------------------------ */
  useEffect(() => {
    if (phase !== "ready") return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/data/impacts/index.json", { cache: "force-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload: unknown = await response.json();
        const list = (payload as { impacts?: unknown }).impacts;
        if (!Array.isArray(list)) throw new Error("impacts の形式が不正です");
        const valid = list.filter(isImpactRecord);
        if (!cancelled && valid.length > 0) setImpacts(valid);
      } catch (error) {
        console.warn("[cesium] /data/impacts/index.json を読み込めませんでした:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase]);

  /* ------------------------------------------------------------------ *
   * 時間軸に連動した影響イベントの強調
   *
   * `isImpactActiveAt(impact, viewTime)` が真の案件だけを通常の色で描き、
   * 期間外の案件の工区・規制・迂回路・歩道切替は淡色にして「期間外」と明示する。
   * ------------------------------------------------------------------ */
  useEffect(() => {
    if (phase !== "ready") return;
    const Cesium = cesiumRef.current;
    if (!Cesium) return;

    /** レイヤーごとの alpha（有効時 / 期間外） */
    const ALPHA: Partial<Record<LayerId, { on: number; off: number }>> = {
      workzone: { on: 0.28, off: 0.1 },
      regulation: { on: 1, off: 0.25 },
      detour: { on: 1, off: 0.25 },
      pedestrian: { on: 1, off: 0.25 },
    };

    for (const source of OVERLAY_SOURCES) {
      const spec = ALPHA[source.kind];
      const dataSource = overlaysRef.current.get(source.kind);
      if (!spec || !dataSource) continue;
      const base = Cesium.Color.fromCssColorString(swatchOf(source.kind));

      for (const entity of dataSource.entities.values) {
        const value = entity.properties?.projectId;
        const projectId = value && typeof value.getValue === "function" ? value.getValue() : null;
        // 案件が特定できない地物は有効として扱う（消さない）
        const active = typeof projectId === "string" ? activeProjectIds.has(projectId) : true;
        const material = new Cesium.ColorMaterialProperty(
          base.withAlpha(active ? spec.on : spec.off),
        );
        if (entity.polyline) entity.polyline.material = material;
        if (entity.polygon) entity.polygon.material = material;
      }
    }

    viewerRef.current?.scene.requestRender();
  }, [phase, activeProjectIds, overlayVersion]);

  /* ------------------------------------------------------------------ *
   * 選択案件へカメラ移動
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || phase !== "ready" || !selectedProjectId) return;

    const project = getProjectById(selectedProjectId);
    if (!project) return;

    const dataSource = overlaysRef.current.get("workzone");
    const entity = dataSource?.entities.values.find((candidate) => {
      const value = candidate.properties?.projectId;
      return value && typeof value.getValue === "function"
        ? value.getValue() === selectedProjectId
        : false;
    });

    if (entity) {
      // 工区の外接球へ寄る（代表点より正確）
      void viewer.flyTo(entity, {
        duration: CESIUM_CAMERA.flightSeconds,
        offset: new Cesium.HeadingPitchRange(
          0,
          Cesium.Math.toRadians(-38),
          CESIUM_CAMERA.focusRangeM,
        ),
      });
      return;
    }

    // 工区データが未読込のときは代表点へ寄る
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        project.location.center.longitude,
        project.location.center.latitude,
        CESIUM_CAMERA.focusRangeM,
      ),
      duration: CESIUM_CAMERA.flightSeconds,
    });
    // 工区データの読み込み完了後にも実行し、工区の外接球へ寄り直す
  }, [selectedProjectId, phase, overlayVersion]);

  /* ------------------------------------------------------------------ *
   * 住所検索のピン
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || phase !== "ready") return;

    if (pinRef.current) {
      viewer.entities.remove(pinRef.current);
      pinRef.current = null;
      viewer.scene.requestRender();
    }
    if (!geocodePin) return;

    pinRef.current = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(geocodePin.longitude, geocodePin.latitude),
      point: {
        pixelSize: 14,
        // 色は必ずデザイントークン／レイヤー定義から取る（独自 hex を増やさない）
        color: Cesium.Color.fromCssColorString(swatchOf("regulation")),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: geocodePin.label,
        font: "600 14px sans-serif",
        fillColor: Cesium.Color.BLACK,
        showBackground: true,
        backgroundColor: Cesium.Color.WHITE.withAlpha(0.86),
        pixelOffset: new Cesium.Cartesian2(0, -28),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    // ピンの出典（公的ジオコーダー）はラベルとクレジット欄の両方に出す
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        geocodePin.longitude,
        geocodePin.latitude,
        CESIUM_CAMERA.pinHeightM,
      ),
      duration: CESIUM_CAMERA.flightSeconds,
    });
    viewer.scene.requestRender();
  }, [geocodePin, phase]);

  /* ------------------------------------------------------------------ *
   * 完成予想モデル（modelUrl がある案件のみ）
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || phase !== "ready") return;

    if (modelRef.current) {
      viewer.entities.remove(modelRef.current);
      modelRef.current = null;
      viewer.scene.requestRender();
    }
    if (!selectedProjectId || completionMode === "current") return;

    const project = getProjectById(selectedProjectId);
    const modelUrl = project?.visual.modelUrl;
    if (!project || !modelUrl) return;

    const translucent = completionMode === "compare";
    modelRef.current = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        project.location.center.longitude,
        project.location.center.latitude,
      ),
      model: {
        uri: modelUrl,
        scale: 1,
        color: translucent ? Cesium.Color.WHITE.withAlpha(0.55) : Cesium.Color.WHITE,
        colorBlendMode: translucent ? Cesium.ColorBlendMode.MIX : Cesium.ColorBlendMode.HIGHLIGHT,
        colorBlendAmount: translucent ? 0.5 : 0,
      },
    });
    viewer.scene.requestRender();
  }, [selectedProjectId, completionMode, phase]);

  /* ------------------------------------------------------------------ *
   * 操作パネルに出す重ね合わせレイヤー
   * ------------------------------------------------------------------ */
  const overlayKinds: LayerId[] = ["workzone", "markers", "completion", "regulation", "detour", "pedestrian"];

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.canvas} aria-label="CesiumJS 3Dビュー" />

      {phase === "loading" && (
        <div className={styles.overlay}>
          <div className="spinner">
            <span className="ring" aria-hidden="true" />
            <span className={styles.overlayText}>{statusText}</span>
          </div>
        </div>
      )}

      {phase === "failed" && (
        <div className={styles.overlay}>
          <p className="empty-note">
            {statusText}
            <br />
            内蔵の3Dビューアへ切り替えました。工事情報はそのまま閲覧できます。
          </p>
        </div>
      )}

      {/* 「住所から探す」パネルと同じ位置を使うため、ピン表示中は隠す */}
      {phase === "ready" && !geocodePin && (
        <div className={`float ${styles.panel}`} aria-label="3D表示の設定">
          <span className={styles.panelLabel}>背景</span>
          <div className="seg" role="group" aria-label="背景タイルの切り替え">
            {(Object.keys(GSI_TILES) as GsiTileId[]).map((id) => (
              <button
                key={id}
                type="button"
                className={imagery === id ? "active" : ""}
                aria-pressed={imagery === id}
                onClick={() => setImagery(id)}
              >
                {GSI_TILES[id].label}
              </button>
            ))}
          </div>

          <span className={styles.panelLabel}>基盤レイヤー</span>
          <div className={styles.toggleRow}>
            <button
              type="button"
              className={`chip-btn ${visibleLayers.terrain ? "on" : ""}`}
              aria-pressed={visibleLayers.terrain}
              title="サイドバーの「地形・地盤」と同じスイッチです（PLATEAU-Terrain / ion）"
              onClick={() => setLayerVisible("terrain", !visibleLayers.terrain)}
            >
              地形 {visibleLayers.terrain ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              className={`chip-btn ${visibleLayers.city ? "on" : ""}`}
              aria-pressed={visibleLayers.city}
              title="サイドバーの「都市モデル」と同じスイッチです（PLATEAU 3D Tiles / ion）"
              onClick={() => setLayerVisible("city", !visibleLayers.city)}
            >
              3D建物 {visibleLayers.city ? "ON" : "OFF"}
            </button>
          </div>

          {/* 実際に使われている供給元を操作パネル内にも出す（見た目だけのトグルにしない） */}
          <p className={styles.panelNote}>3D建物: {buildingsLabel}</p>
          <p className={styles.panelNote}>地形: {terrainLabel}</p>

          <span className={styles.panelLabel}>重ね合わせ</span>
          <div className={styles.toggleRow}>
            {overlayKinds.map((kind) => {
              const layer = LAYERS.find((l) => l.id === kind);
              if (!layer) return null;
              const available = kind !== "completion" || Boolean(selectedProject?.visual.modelUrl);
              return (
                <button
                  key={kind}
                  type="button"
                  className={`chip-btn ${visibleLayers[kind] ? "on" : ""}`}
                  aria-pressed={visibleLayers[kind]}
                  disabled={!available}
                  title={available ? layer.name : "この案件には完成予想モデル（GLB）が未登録です"}
                  onClick={() => toggleLayer(kind)}
                >
                  <span
                    className={styles.swatch}
                    style={{ background: layer.swatch }}
                    aria-hidden="true"
                  />
                  {layer.name}
                </button>
              );
            })}
          </div>

          {/* 影響イベントの正直な内訳（有効／期間外） */}
          <p className={`${styles.panelNote} mono`}>
            影響イベント: 有効 {activeImpactCount} 件 / 期間外 {inactiveImpactCount} 件
          </p>
          <p className={styles.panelNote}>
            期間外の工区・規制・迂回路・歩道切替は淡色で表示しています（非表示ではありません）。
          </p>
          {selectedImpacts.length > 0 && (
            <ul className={styles.impactList}>
              {selectedImpacts.slice(0, 4).map((impact) => {
                const active = activeProjectIds.has(impact.projectId);
                return (
                  <li key={impact.id}>
                    <span className={styles.impactType}>{IMPACT_TYPE_LABEL[impact.type]}</span>
                    <span className={styles.impactState} data-active={active}>
                      {active ? "有効" : "期間外"}
                    </span>
                    <span className={styles.impactTitle}>{impact.title}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {/* 3D建物が未構成のときは理由を必ず出す（表示できていないものを表示中と書かない） */}
          {buildingPlan.source === "none" && buildingPlan.reason && (
            <p className={styles.panelNote}>{buildingPlan.reason}</p>
          )}

          {selectedProject && !selectedProject.visual.modelUrl && (
            <p className={styles.panelNote}>
              この案件には完成予想モデル（GLB）が未登録のため、3D での完成予想は表示できません。
              手続き生成の完成予想は「内蔵3D」ビューアで確認できます。
            </p>
          )}
        </div>
      )}

      {phase === "ready" && (
        <div className={styles.credits}>
          <span>
            <strong>実際に表示中の供給元</strong>／地形: {terrainLabel}／3D建物: {buildingsLabel}
          </span>
          <span>
            {CESIUM_ATTRIBUTION.gsi}（
            <a href={CESIUM_ATTRIBUTION.gsiUrl} target="_blank" rel="noreferrer">
              地理院タイル一覧
            </a>
            ）
            {/* PLATEAU-Terrain の出典は、実際に読み込めたときだけ出す */}
            {terrainSource === "plateau" ? `／${CESIUM_ATTRIBUTION.plateauTerrain}` : ""}
            ／{CESIUM_ATTRIBUTION.cesium}
          </span>
          {/* 実際に読めた3D建物の出典。ion の場合は表示が必須。 */}
          {buildingAttribution && <span>{buildingAttribution}</span>}
          {/* 住所検索ピンの出典（公的ジオコーダー） */}
          {geocodePin && (
            <span>
              住所検索ピン: {geocodePin.label}（{geocodePin.attribution}／粒度 {geocodePin.precision}）
            </span>
          )}
          <span>
            対象 {projectCount} 案件。施工範囲は自社現場台帳（PostGIS）、
            住所検索は国土地理院 住所検索API。両者は別機能です。
          </span>
        </div>
      )}
    </div>
  );
}
