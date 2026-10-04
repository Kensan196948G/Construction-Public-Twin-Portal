"use client";

/**
 * 3D ビューア本体（工事みえるマップ 3D Beta のメインビューポート）。
 *
 * 構成:
 *   - 内蔵の手続き生成都市（TerrainLayer / LocalCityModel）… 既定の背景。
 *     外部ネットワークが無くても必ず表示できる。
 *   - PLATEAU 3D Tiles（PlateauTileset）… 環境変数が設定されている時のみ試行。
 *     失敗・タイムアウト時は内蔵背景へ自動フォールバックし、バッジで正直に表示。
 *   - 工区 / 工事位置 / 完成予想 / 規制・迂回・歩道切替（各レイヤー）。
 *   - カメラ操作とプリセット（CameraController）。
 *
 * WebGL が使えない環境や初期化に失敗した場合は、例外を投げずに
 * 「3Dを表示できません」と 2D への切替ボタンを表示する。
 */
import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { publicImpacts } from "@/lib/data/impacts";
import { publicProjectRecords } from "@/lib/data/projects";
import { useAppStore } from "@/lib/store/useAppStore";
import {
  CAMERA_PRESETS,
  DEFAULT_CAMERA_TARGET,
  cameraPositionFor,
  presetById,
  type CameraPresetId,
} from "@/lib/viewer/cameraPresets";
import {
  LOCAL_CITY_TILESET,
  PLATEAU_TILESET,
  TILESET_LOAD_TIMEOUT_MS,
} from "@/lib/viewer/tileConfig";
import {
  SCENE_COLORS,
  buildCityLayout,
  projectRadius,
  projectSceneCenter,
  rectFromRing,
  type Rect,
} from "@/lib/viewer/sceneBuilder";

import { CameraController, type CameraCommand } from "./CameraController";
import { DetourLayer } from "./DetourLayer";
import { ImpactLayer } from "./ImpactLayer";
import { LocalCityModel } from "./LocalCityModel";
import { PlateauTileset, type PlateauStatus } from "./PlateauTileset";
import { ProjectOverlay } from "./ProjectOverlay";
import { TerrainLayer } from "./TerrainLayer";
import { ViewerErrorBoundary } from "./ViewerErrorBoundary";
import { WorkZoneLayer } from "./WorkZoneLayer";
import styles from "./viewer.module.css";

/* ------------------------------------------------------------------ *
 * WebGL 判定
 * ------------------------------------------------------------------ */

type WebglState = "ok" | "unavailable";

function detectWebgl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!context) return false;
    // 判定用に作ったコンテキストは早めに解放する
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 背景の状態表示
 * ------------------------------------------------------------------ */

interface BaseStatusView {
  state: "ok" | "loading" | "warn" | "off";
  text: string;
}

function baseStatusView(
  base3dSource: "local" | "plateau",
  plateauStatus: PlateauStatus,
): BaseStatusView {
  if (base3dSource === "local") {
    return { state: "ok", text: `内蔵背景：${LOCAL_CITY_TILESET.name}` };
  }
  switch (plateauStatus) {
    case "loading":
      return { state: "loading", text: "PLATEAU: 読み込み中（完了までは内蔵背景を表示）" };
    case "rendering":
      return { state: "ok", text: "PLATEAU: 表示中" };
    case "unconfigured":
      return { state: "warn", text: "PLATEAU: URL未構成 → 内蔵背景を表示" };
    case "unavailable":
      return { state: "warn", text: "PLATEAU: 取得不可 → 内蔵背景を表示" };
    case "timeout":
      return {
        state: "warn",
        text: `PLATEAU: ${Math.round(TILESET_LOAD_TIMEOUT_MS / 1000)}秒で読み込めず → 内蔵背景を表示`,
      };
    case "disabled":
      return { state: "off", text: "PLATEAU: 未使用（内蔵背景を表示）" };
  }
}

/* ------------------------------------------------------------------ *
 * 表示できないときの案内
 * ------------------------------------------------------------------ */

function ViewerNotice({
  title,
  detail,
  hint,
  onSwitchTo2d,
  technical,
}: {
  title: string;
  detail: string;
  hint: string;
  onSwitchTo2d: () => void;
  technical?: string | null;
}) {
  return (
    <div className={styles.fallback} role="alert">
      <div className={styles.fallbackCard}>
        <h2>{title}</h2>
        <p>{detail}</p>
        <p>{hint}</p>
        {technical ? <p className={styles.fallbackDetail}>詳細: {technical}</p> : null}
        <div className={styles.fallbackActions}>
          <button type="button" className="top-btn on" onClick={onSwitchTo2d}>
            2D表示に切り替える
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 本体
 * ------------------------------------------------------------------ */

export function PublicTwinViewer(): React.ReactElement {
  const viewTime = useAppStore((s) => s.viewTime);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const selectedImpactId = useAppStore((s) => s.selectedImpactId);
  const visibleLayers = useAppStore((s) => s.visibleLayers);
  const completionMode = useAppStore((s) => s.completionMode);
  const base3dSource = useAppStore((s) => s.base3dSource);
  const selectProject = useAppStore((s) => s.selectProject);
  const selectImpact = useAppStore((s) => s.selectImpact);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const setCompletionMode = useAppStore((s) => s.setCompletionMode);

  const records = useMemo(() => publicProjectRecords(), []);
  const impacts = useMemo(() => publicImpacts(), []);
  const viewDate = useMemo(() => new Date(viewTime), [viewTime]);

  // 工区と重なる場所には周辺建物を建てない
  const layout = useMemo(() => {
    const avoid = records
      .map((record) => rectFromRing(projectSceneCenter(record.project), record.geometry.zone))
      .filter((rect): rect is Rect => rect !== null);
    return buildCityLayout({ avoid });
  }, [records]);

  const focus = useMemo(() => {
    const record = records.find((r) => r.project.id === selectedProjectId);
    if (!record) return null;
    const center = projectSceneCenter(record.project);
    return { x: center.x, z: center.z, radius: projectRadius(record.project) };
  }, [records, selectedProjectId]);

  const [command, setCommand] = useState<CameraCommand>({ preset: "overview", nonce: 0 });
  const applyPreset = useCallback((preset: CameraPresetId) => {
    setCommand((current) => ({ preset, nonce: current.nonce + 1 }));
  }, []);

  const [plateauAttempt, setPlateauAttempt] = useState<PlateauStatus>("loading");
  const [plateauRetry, setPlateauRetry] = useState(0);
  const handlePlateauStatus = useCallback((status: PlateauStatus) => {
    setPlateauAttempt(status);
  }, []);
  const retryPlateau = useCallback(() => {
    setPlateauAttempt("loading");
    setPlateauRetry((count) => count + 1);
  }, []);

  // WebGL の可否は初回レンダリング時に一度だけ判定する。
  // このコンポーネントは app/page.tsx で dynamic(..., { ssr: false }) として読み込まれるため、
  // ここは必ずブラウザで実行される（document を参照しても安全）。
  const [webgl] = useState<WebglState>(() => (detectWebgl() ? "ok" : "unavailable"));
  const [failure, setFailure] = useState<string | null>(null);
  const contextCleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => contextCleanup.current?.(), []);

  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);

  /**
   * 背景クリックで選択解除する。
   * ドラッグ（カメラ操作）で解除されないよう、押下位置から一定以上動いた場合は無視する。
   */
  const handlePointerMissed = useCallback((event: MouseEvent) => {
    const start = pointerDownAt.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    selectProject(null);
  }, [selectProject]);

  const handleSelectProject = useCallback(
    (projectId: string) => {
      selectProject(projectId);
    },
    [selectProject],
  );

  const handleSelectImpact = useCallback(
    (impactId: string) => {
      selectImpact(impactId);
    },
    [selectImpact],
  );

  const switchTo2d = useCallback(() => setViewMode("2d"), [setViewMode]);

  const usingPlateau = base3dSource === "plateau";
  // disabled / unconfigured はこのコンポーネント側で導出する（PlateauTileset は試行結果のみ報告）
  const plateauStatus: PlateauStatus =
    base3dSource !== "plateau"
      ? "disabled"
      : !PLATEAU_TILESET.configured
        ? "unconfigured"
        : plateauAttempt;
  const plateauRendererActive = usingPlateau && plateauStatus === "rendering";
  const badge = baseStatusView(base3dSource, plateauStatus);
  const canRetryPlateau = plateauStatus === "unavailable" || plateauStatus === "timeout";

  if (webgl === "unavailable" || failure) {
    return (
      <div className={styles.root}>
        <ViewerNotice
          title="3Dを表示できません"
          detail={
            failure ??
            "この環境では WebGL（3D描画）を利用できないため、3Dビューアを起動できませんでした。"
          }
          hint="2D表示に切り替えると、工事位置・交通規制・迂回路を平面図で確認できます。"
          technical={failure}
          onSwitchTo2d={switchTo2d}
        />
      </div>
    );
  }

  const fallbackNotice = (
    <ViewerNotice
      title="3Dを表示できません"
      detail="3Dシーンの初期化中にエラーが発生しました。"
      hint="2D表示に切り替えると、工事位置・交通規制・迂回路を平面図で確認できます。"
      technical={failure}
      onSwitchTo2d={switchTo2d}
    />
  );

  return (
    <div className={styles.root}>
      <ViewerErrorBoundary
        onError={(message) => setFailure(`3Dシーンの初期化に失敗しました（${message}）。`)}
        fallback={fallbackNotice}
      >
        <div
          className={styles.canvasWrap}
          onPointerDown={(event) => {
            pointerDownAt.current = { x: event.clientX, y: event.clientY };
          }}
        >
          <Canvas
            dpr={[1, 2]}
            camera={{
              fov: 45,
              near: 1,
              far: 6000,
              position: cameraPositionFor(DEFAULT_CAMERA_TARGET, presetById("overview")),
            }}
            gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
            onCreated={({ gl }) => {
              const canvas = gl.domElement;
              const onContextLost = (event: Event) => {
                event.preventDefault();
                setFailure("WebGL コンテキストが失われたため、3D表示を継続できません。");
              };
              canvas.addEventListener("webglcontextlost", onContextLost);
              contextCleanup.current = () =>
                canvas.removeEventListener("webglcontextlost", onContextLost);
            }}
            onPointerMissed={handlePointerMissed}
          >
            <color attach="background" args={[SCENE_COLORS.sky]} />
            <fog attach="fog" args={[SCENE_COLORS.fog, 1000, 3200]} />
            <hemisphereLight args={[0xf2f5f9, 0x9aa0a8, 0.95]} />
            <directionalLight position={[-320, 520, 260]} intensity={0.7} />
            <directionalLight position={[300, 260, -300]} intensity={0.25} />

            {/* 背景（地形は常に、内蔵都市は PLATEAU 表示中以外） */}
            <TerrainLayer visible={visibleLayers.terrain} />
            <LocalCityModel layout={layout} visible={!plateauRendererActive && visibleLayers.city} />
            <PlateauTileset
              key={`plateau-${plateauRetry}`}
              enabled={usingPlateau}
              onStatus={handlePlateauStatus}
            />

            {/* 工事 */}
            <WorkZoneLayer
              records={records}
              viewTime={viewDate}
              selectedProjectId={selectedProjectId}
              visible={visibleLayers.workzone}
              onSelect={handleSelectProject}
            />
            <ProjectOverlay
              records={records}
              viewTime={viewDate}
              markersVisible={visibleLayers.markers}
              completionVisible={visibleLayers.completion}
              completionMode={completionMode}
              selectedProjectId={selectedProjectId}
              onSelect={handleSelectProject}
            />

            {/* 影響（時間軸に連動） */}
            <ImpactLayer
              records={records}
              impacts={impacts}
              viewTime={viewDate}
              selectedImpactId={selectedImpactId}
              regulationVisible={visibleLayers.regulation}
              pedestrianVisible={visibleLayers.pedestrian}
              onSelectImpact={handleSelectImpact}
            />
            <DetourLayer
              records={records}
              impacts={impacts}
              viewTime={viewDate}
              selectedImpactId={selectedImpactId}
              visible={visibleLayers.detour}
              onSelectImpact={handleSelectImpact}
            />

            <CameraController focus={focus} command={command} />
          </Canvas>
        </div>
      </ViewerErrorBoundary>

      {/* カメラプリセットと完成予想の切替（viewer3d 側の UI） */}
      <div className={`float ${styles.viewerBar}`} aria-label="3D表示の操作">
        <span className={styles.viewerBarLabel}>カメラ</span>
        <div className={styles.viewerBarGroup} role="group" aria-label="カメラプリセット">
          {CAMERA_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`chip-btn ${command.preset === preset.id ? "on" : ""}`}
              aria-pressed={command.preset === preset.id}
              title={preset.description}
              onClick={() => applyPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <span className={styles.viewerBarLabel}>完成予想</span>
        <div className={styles.viewerBarGroup} role="group" aria-label="完成予想の表示">
          {(
            [
              ["current", "現在"],
              ["planned", "完成予想"],
              ["compare", "比較"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`chip-btn ${completionMode === mode ? "on" : ""}`}
              aria-pressed={completionMode === mode}
              onClick={() => setCompletionMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 背景の種類と取得状態（取得できていないのに「表示中」と出さない） */}
      <div className={`float ${styles.badge}`} role="status" aria-live="polite">
        <span className={styles.badgeDot} data-state={badge.state} aria-hidden="true" />
        <span className={styles.badgeText}>{badge.text}</span>
        {canRetryPlateau ? (
          <button type="button" className="chip-btn" onClick={retryPlateau}>
            再試行
          </button>
        ) : null}
      </div>

      {/* 内蔵背景の出典（PLATEAU 表示中は TilesAttributionOverlay が出典を出す） */}
      {plateauRendererActive ? null : (
        <p className={styles.attribution}>
          背景: {LOCAL_CITY_TILESET.name}（{LOCAL_CITY_TILESET.attribution}）／
          完成予想・規制は開発用サンプルデータです。
          {usingPlateau && PLATEAU_TILESET.url
            ? ` PLATEAU: ${PLATEAU_TILESET.attribution}`
            : ""}
        </p>
      )}
    </div>
  );
}
