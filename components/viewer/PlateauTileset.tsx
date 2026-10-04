"use client";

/**
 * PLATEAU 3D Tiles（外部 3D 都市モデル）の描画。
 *
 * 方針（仕様書 #19/#23）:
 *   - NEXT_PUBLIC_PLATEAU_TILESET_URL が設定されている場合のみ試行する。
 *   - モジュール解決・初期化・取得のいずれが失敗してもアプリを落とさない。
 *     → 動的 import + try/catch、TILESET_LOAD_TIMEOUT_MS でタイムアウト。
 *   - 失敗・タイムアウト時は呼び出し側（PublicTwinViewer）が内蔵背景を表示し、
 *     バッジに「取得不可 → 内蔵背景」と正直に出す。
 *   - PLATEAU は CC BY 4.0 のため、TilesAttributionOverlay で出典を表示する。
 *
 * 座標系:
 *   ReorientationPlugin は「X = 西, Z = 北」のローカル座標系へ再配置する
 *   （3d-tiles-renderer の仕様）。本アプリの scene は「X = 東, Z = 南」なので、
 *   親グループで Y 軸 180 度回転させて一致させる。
 */
import { useEffect, useRef, useState } from "react";

import { SCENE_ORIGIN } from "@/lib/geo/transform";
import { PLATEAU_TILESET, TILESET_LOAD_TIMEOUT_MS } from "@/lib/viewer/tileConfig";

const DEG2RAD = Math.PI / 180;

/**
 * 基準点周辺のおおよその地盤高（m）。
 * PLATEAU の地面を本アプリの y=0 に合わせるための近似値で、
 * 厳密な地形高ではなく MVP の位置合わせ用。
 */
const PLATEAU_GROUND_HEIGHT_M = 30;

/** PLATEAU 背景の状態。バッジ表示にそのまま使う。 */
export type PlateauStatus =
  | "disabled"
  | "unconfigured"
  | "loading"
  | "rendering"
  | "unavailable"
  | "timeout";

type R3fModule = typeof import("3d-tiles-renderer/r3f");
type ThreePluginsModule = typeof import("3d-tiles-renderer/three/plugins");

interface LoadedModules {
  r3f: R3fModule;
  plugins: ThreePluginsModule;
}

export interface PlateauTilesetProps {
  /** 3D背景として PLATEAU が選択されているか */
  enabled: boolean;
  /**
   * 状態通知。
   * PublicTwinViewer 側で useState の setter、または useCallback で
   * 参照が安定した関数を渡すこと（再レンダリングのたびに再読み込みさせないため）。
   */
  onStatus: (status: PlateauStatus) => void;
}

export function PlateauTileset({ enabled, onStatus }: PlateauTilesetProps) {
  const [modules, setModules] = useState<LoadedModules | null>(null);
  const [abandoned, setAbandoned] = useState(false);
  const loadedRef = useRef(false);
  const configured = PLATEAU_TILESET.configured;

  // 動的 import（失敗してもアプリ全体を落とさない）
  useEffect(() => {
    if (!enabled) {
      setModules(null);
      setAbandoned(false);
      loadedRef.current = false;
      onStatus("disabled");
      return;
    }
    if (!configured) {
      onStatus("unconfigured");
      return;
    }

    let cancelled = false;
    setAbandoned(false);
    loadedRef.current = false;
    onStatus("loading");

    void (async () => {
      try {
        const [r3f, plugins] = await Promise.all([
          import("3d-tiles-renderer/r3f"),
          import("3d-tiles-renderer/three/plugins"),
        ]);
        if (cancelled) return;
        setModules({ r3f, plugins });
      } catch (error) {
        if (cancelled) return;
        console.warn(
          "[viewer3d] PLATEAU 3D Tiles のモジュールを読み込めませんでした。内蔵背景を使用します。",
          error,
        );
        setAbandoned(true);
        onStatus("unavailable");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, configured, onStatus]);

  // タイムアウト（タイルが一定時間読み込めなければ内蔵背景へ）
  useEffect(() => {
    if (!modules || abandoned) return;
    const timer = window.setTimeout(() => {
      if (loadedRef.current) return;
      console.warn(
        `[viewer3d] PLATEAU 3D Tiles が ${TILESET_LOAD_TIMEOUT_MS} ms 以内に読み込めなかったため、内蔵背景へ切り替えます。`,
      );
      setAbandoned(true);
      setModules(null);
      onStatus("timeout");
    }, TILESET_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [modules, abandoned, onStatus]);

  if (!enabled || !configured || abandoned || !modules) return null;

  const { TilesRenderer, TilesPlugin, TilesAttributionOverlay } = modules.r3f;
  const { ReorientationPlugin } = modules.plugins;

  return (
    // ReorientationPlugin の「X = 西, Z = 北」を本アプリの「X = 東, Z = 南」に合わせる
    <group rotation={[0, Math.PI, 0]}>
      <TilesRenderer
        url={PLATEAU_TILESET.url}
        errorTarget={6}
        onLoadTileset={() => {
          loadedRef.current = true;
          onStatus("rendering");
        }}
        onLoadError={(event: unknown) => {
          console.warn(
            "[viewer3d] PLATEAU の一部タイルで読み込みエラーが発生しました（該当タイルのみスキップされます）。",
            event,
          );
        }}
      >
        <TilesPlugin
          plugin={ReorientationPlugin}
          args={{
            lat: SCENE_ORIGIN.latitude * DEG2RAD,
            lon: SCENE_ORIGIN.longitude * DEG2RAD,
            height: PLATEAU_GROUND_HEIGHT_M,
            recenter: true,
          }}
        />
        <TilesAttributionOverlay
          style={{
            position: "absolute",
            left: 16,
            bottom: 14,
            padding: 0,
            pointerEvents: "none",
            color: "var(--faint)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            lineHeight: 1.5,
            maxWidth: "min(460px, calc(100% - 32px))",
          }}
        >
          {`出典: ${PLATEAU_TILESET.attribution}（${PLATEAU_TILESET.license}）`}
        </TilesAttributionOverlay>
      </TilesRenderer>
    </group>
  );
}
