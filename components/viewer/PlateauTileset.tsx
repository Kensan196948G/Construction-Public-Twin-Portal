"use client";

/**
 * PLATEAU 3D Tiles（外部 3D 都市モデル）の実描画。
 *
 * 方針（仕様書 #19/#23）:
 *   - NEXT_PUBLIC_PLATEAU_TILESET_URL が設定されている場合のみ試行する。
 *   - モジュール解決・初期化・取得のいずれが失敗してもアプリを落とさない。
 *     → 動的 import + try/catch、TILESET_LOAD_TIMEOUT_MS でタイムアウト。
 *   - 失敗・タイムアウト時は呼び出し側（PublicTwinViewer）が内蔵背景を表示し、
 *     バッジに「取得不可 → 内蔵背景」と正直に出す。
 *   - PLATEAU は CC BY 4.0 のため、TilesAttributionOverlay で出典を表示する。
 *
 * このコンポーネントは「1 回の読み込み試行」だけを担当する。
 * 再試行したい場合は呼び出し側で key を変えて再マウントする
 * （内部にリセット用の state を持たないため、effect 内での同期 setState が不要）。
 * `disabled` / `unconfigured` は呼び出し側が導出する。
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

/**
 * PLATEAU 背景の状態。バッジ表示にそのまま使う。
 * このコンポーネントが報告するのは loading / rendering / unavailable / timeout のみ。
 * disabled / unconfigured は呼び出し側（PublicTwinViewer）が導出する。
 */
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
   * 状態通知。呼び出し側で参照が安定した関数（useCallback / useState の setter）を渡すこと。
   */
  onStatus: (status: PlateauStatus) => void;
}

export function PlateauTileset({ enabled, onStatus }: PlateauTilesetProps) {
  const [modules, setModules] = useState<LoadedModules | null>(null);
  const [abandoned, setAbandoned] = useState(false);
  const readyRef = useRef(false);
  const configured = PLATEAU_TILESET.configured;

  // 動的 import（失敗してもアプリ全体を落とさない）。
  // setState はすべて async コールバック内で行う。
  useEffect(() => {
    if (!enabled || !configured) return;

    let cancelled = false;
    readyRef.current = false;
    onStatus("loading");

    void (async () => {
      try {
        const [r3f, plugins] = await Promise.all([
          import("3d-tiles-renderer/r3f"),
          import("3d-tiles-renderer/three/plugins"),
        ]);
        if (!cancelled) setModules({ r3f, plugins });
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

  // タイムアウト（一定時間でタイルが読めなければ内蔵背景へ切り替える）
  useEffect(() => {
    if (!enabled || !configured || abandoned) return;

    const timer = window.setTimeout(() => {
      if (readyRef.current) return;
      console.warn(
        `[viewer3d] PLATEAU 3D Tiles が ${TILESET_LOAD_TIMEOUT_MS} ms 以内に読み込めなかったため、内蔵背景へ切り替えます。`,
      );
      setAbandoned(true);
      onStatus("timeout");
    }, TILESET_LOAD_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [enabled, configured, abandoned, onStatus]);

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
          readyRef.current = true;
          onStatus("rendering");
        }}
        onLoadError={(event) => {
          // 個別タイルの失敗は該当タイルのみスキップされる（致命的ではない）
          console.warn(
            "[viewer3d] PLATEAU の一部タイルで読み込みエラーが発生しました。",
            event.error,
            event.url,
          );
        }}
      >
        <TilesPlugin
          plugin={ReorientationPlugin}
          args={[
            {
              lat: SCENE_ORIGIN.latitude * DEG2RAD,
              lon: SCENE_ORIGIN.longitude * DEG2RAD,
              height: PLATEAU_GROUND_HEIGHT_M,
              recenter: true,
            },
          ]}
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
