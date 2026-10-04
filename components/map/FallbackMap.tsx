"use client";

/**
 * 2D フォールバック地図（AC-016: 3D が使えなくても 2D で閲覧できる）。
 *
 * 重要: **外部タイルサーバに依存しない。**
 *   - スタイルは `lib/viewer/mapStyle.ts` のローカル定義（background + GeoJSON）のみ。
 *   - データは同一オリジンの `/data/geo/all/*.geojson` を fetch する。
 *   - タイル・スプライト・グリフの取得が一切発生しないため、ネットワーク遮断時でも
 *     背景・工区・規制・迂回路・歩道切替・工事位置が描画される。
 *   - 初期化に失敗しても例外を投げず、日本語のエラー表示に切り替える
 *     （一覧・検索・詳細はそのまま使える）。
 */
import { useEffect, useRef, useState, type ReactElement } from "react";

import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";

import { publicProjects, getProjectById } from "@/lib/data/projects";
import {
  collectionBounds,
  emptyCollection,
  validateFeatureCollection,
  type FeatureCollection,
} from "@/lib/geo/geojson";
import { useAppStore, type LayerId } from "@/lib/store/useAppStore";
import {
  MAP_CLICK_LAYERS,
  MAP_FIT_PADDING,
  MAP_GEOJSON_SOURCES,
  MAP_INITIAL_VIEW,
  MAP_LAYERS,
  MAP_SOURCE_IDS,
  NO_SELECTION_ID,
  STORE_LAYER_TO_MAP_LAYERS,
  buildMapStyle,
  type MapLayerFilter,
} from "@/lib/viewer/mapStyle";

import styles from "./FallbackMap.module.css";
import { createMaplibreWorkerUrl } from "./maplibreWorker";
import "maplibre-gl/dist/maplibre-gl.css";

type MaplibreModule = typeof import("maplibre-gl");
type MapStatus = "loading" | "ready" | "error";

/** スタイル読込がこの時間内に完了しなければエラー表示へ切り替える（無限スピナー防止） */
const MAP_LOAD_TIMEOUT_MS = 12_000;

/** 選択案件だけを強調表示するフィルタ */
function selectionFilter(projectId: string | null): MapLayerFilter {
  return ["==", ["get", "projectId"], projectId ?? NO_SELECTION_ID];
}

export function FallbackMap(): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<MaplibreModule | null>(null);
  const markerRef = useRef<{ remove: () => void } | null>(null);
  /** 案件ごとの工区バウンディングボックス（選択時のカメラ移動に使う） */
  const workzoneBoundsRef = useRef(new Map<string, [number, number, number, number]>());

  const [status, setStatus] = useState<MapStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);

  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const visibleLayers = useAppStore((s) => s.visibleLayers);

  /* ---------------------------------------------------------------- *
   * 初期化（ローカルスタイルのみ・外部リクエストなし）
   * ---------------------------------------------------------------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let loadTimer: ReturnType<typeof setTimeout> | null = null;

    /** 同一オリジンの GeoJSON を読み込んでソースへ流し込む */
    const loadOverlays = async (map: MapLibreMap) => {
      const failures: string[] = [];
      const bounds: [number, number, number, number][] = [];

      await Promise.all(
        MAP_GEOJSON_SOURCES.map(async (source) => {
          let data: FeatureCollection = emptyCollection();
          try {
            const response = await fetch(source.url, { cache: "force-cache" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const json: unknown = await response.json();
            const errors = validateFeatureCollection(json);
            if (errors.length > 0) throw new Error(errors[0]);
            data = json as FeatureCollection;
          } catch (error) {
            failures.push(source.label);
            console.warn(
              `[FallbackMap] ${source.label}（${source.url}）を読み込めませんでした:`,
              error,
            );
          }

          const geojsonSource = map.getSource(source.id) as GeoJSONSource | undefined;
          if (!geojsonSource) return;
          await geojsonSource.setData(data);

          const box = collectionBounds(data);
          if (box) bounds.push(box);

          // 工区は案件ごとの範囲を覚えておき、選択時のカメラ移動に使う
          if (source.id === MAP_SOURCE_IDS.workzone) {
            for (const feature of data.features) {
              const featureBounds = collectionBounds({
                type: "FeatureCollection",
                features: [feature],
              });
              if (!featureBounds) continue;
              workzoneBoundsRef.current.set(feature.properties.projectId, featureBounds);
            }
          }
        }),
      );

      if (cancelled) return;

      if (bounds.length > 0) {
        const west = Math.min(...bounds.map((b) => b[0]));
        const south = Math.min(...bounds.map((b) => b[1]));
        const east = Math.max(...bounds.map((b) => b[2]));
        const north = Math.max(...bounds.map((b) => b[3]));
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: MAP_FIT_PADDING, duration: 0, maxZoom: 16.5 },
        );
      }

      if (failures.length > 0) setWarnings(failures);
      setStatus("ready");
    };

    /** レイヤー単位のクリック／ホバー（スタイル読込後に登録する） */
    const registerInteractions = (map: MapLibreMap) => {
      const onClick = (event: MapLayerMouseEvent) => {
        const properties = event.features?.[0]?.properties as
          | { projectId?: unknown }
          | null
          | undefined;
        const projectId = typeof properties?.projectId === "string" ? properties.projectId : "";
        if (projectId) useAppStore.getState().selectProject(projectId);
      };

      for (const layerId of MAP_CLICK_LAYERS) {
        map.on("click", layerId, onClick);
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    };

    const initialize = async () => {
      try {
        const maplibregl = await import("maplibre-gl");
        if (cancelled) return;
        maplibreRef.current = maplibregl;

        // Turbopack は maplibre 内部の動的な `new URL(worker, import.meta.url)` を
        // 解決できないため、自己完結した worker を用意して URL を明示的に渡す。
        // （未指定だと "Worker failed to load" となり GeoJSON ソースが描画されない）
        const workerUrl = await createMaplibreWorkerUrl();
        if (cancelled) return;
        if (workerUrl) {
          maplibregl.setWorkerUrl(workerUrl);
        }

        const map = new maplibregl.Map({
          container,
          style: buildMapStyle(),
          center: MAP_INITIAL_VIEW.center,
          zoom: MAP_INITIAL_VIEW.zoom,
          minZoom: 9,
          maxZoom: 19,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          refreshExpiredTiles: false,
          fadeDuration: 0,
          trackResize: true,
        });
        mapRef.current = map;

        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
          "top-right",
        );
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();

        map.on("error", (event) => {
          // ローカル定義スタイルのため通常は発生しない。画面は落とさない。
          console.warn("[FallbackMap] 地図の警告:", event?.error?.message ?? event);
        });

        map.on("load", () => {
          if (loadTimer) {
            clearTimeout(loadTimer);
            loadTimer = null;
          }
          registerInteractions(map);
          void loadOverlays(map);
        });

        // 読み込みが完了しないまま固まるのを避ける（無限スピナー対策）
        loadTimer = setTimeout(() => {
          if (cancelled || mapRef.current !== map) return;
          setStatus((current) => {
            if (current !== "loading") return current;
            setErrorMessage(
              "地図の読み込みが完了しませんでした。通信環境やブラウザの設定を確認して再試行してください。",
            );
            return "error";
          });
        }, MAP_LOAD_TIMEOUT_MS);
      } catch (error) {
        if (cancelled) return;
        console.error("[FallbackMap] 2D地図を初期化できませんでした:", error);
        setStatus("error");
        setErrorMessage(
          "地図を初期化できませんでした。お使いのブラウザで WebGL が無効になっている可能性があります。",
        );
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      if (loadTimer) {
        clearTimeout(loadTimer);
        loadTimer = null;
      }
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      maplibreRef.current = null;
    };
  }, [attempt]);

  /* ---------------------------------------------------------------- *
   * visibleLayers → レイヤー表示/非表示
   * ---------------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;

    for (const [storeLayer, layerIds] of Object.entries(STORE_LAYER_TO_MAP_LAYERS)) {
      const visible = visibleLayers[storeLayer as LayerId];
      for (const layerId of layerIds) {
        if (!map.getLayer(layerId)) continue;
        try {
          map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
        } catch (error) {
          console.warn(`[FallbackMap] レイヤー ${layerId} の表示を切り替えられませんでした:`, error);
        }
      }
    }
  }, [visibleLayers, status]);

  /* ---------------------------------------------------------------- *
   * selectedProjectId → 強調表示とカメラ追従
   * ---------------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;

    const filter = selectionFilter(selectedProjectId);
    for (const layerId of [MAP_LAYERS.selectedFill, MAP_LAYERS.selectedCasing, MAP_LAYERS.selectedLine]) {
      if (map.getLayer(layerId)) map.setFilter(layerId, filter);
    }

    markerRef.current?.remove();
    markerRef.current = null;

    if (!selectedProjectId) return;
    const project = getProjectById(selectedProjectId);
    if (!project) return;

    const { longitude, latitude } = project.location.center;
    const maplibregl = maplibreRef.current;

    if (maplibregl) {
      // グリフ（フォント）取得が不要な DOM マーカーでラベルを出す
      const element = document.createElement("div");
      element.className = styles.selectionLabel;
      element.textContent = project.publicTitle;
      markerRef.current = new maplibregl.Marker({ element, anchor: "bottom", offset: [0, -14] })
        .setLngLat([longitude, latitude])
        .addTo(map);
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduceMotion ? 0 : 900;

    // 工区と工事位置の両方が視野に入るように合わせる。
    // 工区データが無い場合は工事位置へ寄せる。
    const zoneBounds = workzoneBoundsRef.current.get(selectedProjectId);
    if (zoneBounds) {
      const [west, south, east, north] = zoneBounds;
      map.fitBounds(
        [
          [Math.min(west, longitude), Math.min(south, latitude)],
          [Math.max(east, longitude), Math.max(north, latitude)],
        ],
        { padding: 64, maxZoom: 17, duration, essential: true },
      );
    } else {
      map.flyTo({
        center: [longitude, latitude],
        zoom: Math.max(map.getZoom(), 15.6),
        duration,
        essential: true,
      });
    }
  }, [selectedProjectId, status]);

  const totalCount = publicProjects().length;

  return (
    <div className={styles.wrap}>
      <div
        ref={containerRef}
        className={styles.canvas}
        role="region"
        aria-label="2D地図（工区・交通規制・迂回路・歩道切替・工事位置）"
      />

      {status === "loading" && (
        <div className="spinner">
          <div className="ring" aria-hidden="true" />
          <p className={styles.spinnerText}>2D地図を準備しています…</p>
        </div>
      )}

      {status === "error" && (
        <div className={styles.error} role="alert">
          <p className={styles.errorTitle}>2D地図を表示できませんでした</p>
          <p className={styles.errorBody}>{errorMessage}</p>
          <p className={styles.errorBody}>
            工事一覧・検索・工事詳細はそのまま利用できます。
          </p>
          <button type="button" className="chip-btn" onClick={() => setAttempt((n) => n + 1)}>
            再試行
          </button>
        </div>
      )}

      {status === "ready" && warnings.length > 0 && (
        <p className={styles.warn} role="status">
          一部の地図データを読み込めませんでした（{warnings.join("・")}）
        </p>
      )}

      <p className={styles.note}>
        2D表示 / 全 {totalCount} 件・背景はローカル定義（外部タイル不使用）
      </p>
    </div>
  );
}
