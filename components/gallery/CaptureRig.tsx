"use client";

/**
 * 24現場の3Dプレビューを **1つの WebGL コンテキスト** で順に描画して画像化する内部コンポーネント。
 *
 * なぜ必要か:
 *   ブラウザの WebGL コンテキスト上限は概ね 16 のため、24個の `<Canvas>` を
 *   同時に生成すると必ず破綻する。そこで画面外に撮影専用の Canvas を1つだけ置き、
 *   案件を1件ずつ `SiteScene` に渡して描画 → `toDataURL()` で PNG 化する。
 *
 * 呼び出し側（Site3DGallery）は得られた data URL を `<img>` として並べるだけになる。
 * 撮影に失敗した案件は `null` を返し、呼び出し側がサンプル写真へフォールバックする。
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Component,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { SiteScene } from "@/components/viewer/SiteScene";
import { getProjectById } from "@/lib/data/projects";
import { buildSiteModelData } from "@/lib/site/sceneData";
import { siteCameraFor } from "@/lib/viewer/cameraPresets";
import { SCENE_COLORS } from "@/lib/viewer/sceneBuilder";
import styles from "./Site3DGallery.module.css";

/* ------------------------------------------------------------------ *
 * カメラ
 * ------------------------------------------------------------------ */

/**
 * 撮影用の固定カメラ。
 *
 * `SiteScene` は契約上カメラを制御しない（`<Canvas>` 側の責務）ため、
 * 凍結済みの推奨値 `siteCameraFor(projectId)` をここで適用する。
 * これにより通常の現場ビュー（SiteViewer）と同じ画角で撮影できる。
 */
function ThumbnailFraming({ projectId }: { projectId: string }): null {
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const framing = siteCameraFor(projectId);
    camera.position.set(framing.position[0], framing.position[1], framing.position[2]);
    camera.lookAt(framing.target[0], framing.target[1], framing.target[2]);
  }, [camera, projectId]);

  return null;
}

/* ------------------------------------------------------------------ *
 * 写真テクスチャの事前読込
 * ------------------------------------------------------------------ */

/** 事前読込が固まっても撮影を止めないための上限 (ms) */
const PRELOAD_TIMEOUT_MS = 2500;

/**
 * 写真レイヤー（`SiteScene` の photo データレイヤー）が使うサンプル写真を、
 * 撮影を始める前にブラウザへ読み込ませておく。
 *
 * `THREE.TextureLoader` は非同期のため、これが無いと**最初の1〜2タイルだけ**
 * 「読込中プレースホルダ（アンバー色の板）」のまま画像化されることがある。
 * 画像が1枚も無い環境でも撮影は続行する（失敗は無視し、時間切れでも先へ進む）。
 */
function preloadPhotoTextures(projectIds: string[]): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  const urls = new Set<string>();
  for (const id of projectIds) {
    const project = getProjectById(id);
    if (!project) continue;
    for (const capture of buildSiteModelData(project).captures) urls.add(capture.photoUrl);
  }
  if (urls.size === 0) return Promise.resolve();

  const loads = [...urls].map(
    (url) =>
      new Promise<void>((resolve) => {
        const image = new Image();
        const finish = () => resolve();
        image.onload = finish;
        image.onerror = finish;
        image.src = url;
        if (image.complete) finish();
      }),
  );

  const timeout = new Promise<void>((resolve) => {
    window.setTimeout(resolve, PRELOAD_TIMEOUT_MS);
  });

  return Promise.race([Promise.all(loads).then(() => undefined), timeout]);
}

/* ------------------------------------------------------------------ *
 * 撮影シーケンサ
 * ------------------------------------------------------------------ */

interface CaptureControllerProps {
  projectIds: string[];
  /** 1件あたり、描画が落ち着くまで待つフレーム数 */
  settleFrames: number;
  /** 1件あたりの最低待ち時間 (ms)。テクスチャ読込を待つ。 */
  minSettleMs: number;
  /** 先頭から何件を「写真読込直後」として長めに待つか */
  warmupTiles: number;
  /** 先頭タイルの最低待ち時間 (ms) */
  warmupSettleMs: number;
  onCapture: (projectId: string, dataUrl: string | null) => void;
  onComplete: () => void;
}

function CaptureController({
  projectIds,
  settleFrames,
  minSettleMs,
  warmupTiles,
  warmupSettleMs,
  onCapture,
  onComplete,
}: CaptureControllerProps): ReactElement | null {
  const gl = useThree((s) => s.gl);
  const [index, setIndex] = useState(0);
  const frames = useRef(0);
  const startedAt = useRef(0);
  const captured = useRef(false);
  /** 写真の事前読込が終わるまで撮影を始めない */
  const photosReady = useRef(false);

  const projectId: string | undefined = projectIds[index];

  useEffect(() => {
    let cancelled = false;
    void preloadPhotoTextures(projectIds).then(() => {
      if (!cancelled) photosReady.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [projectIds]);

  useEffect(() => {
    frames.current = 0;
    startedAt.current = 0;
    captured.current = false;
  }, [index]);

  useFrame(() => {
    if (captured.current || projectId === undefined) return;
    if (!photosReady.current) return;

    // 事前読込が終わった最初のフレームから待ち時間を数える
    if (frames.current === 0) startedAt.current = performance.now();
    frames.current += 1;

    const settleMs = index < warmupTiles ? Math.max(minSettleMs, warmupSettleMs) : minSettleMs;
    const settled =
      frames.current >= settleFrames && performance.now() - startedAt.current >= settleMs;
    if (!settled) return;
    captured.current = true;

    let dataUrl: string | null = null;
    try {
      const url = gl.domElement.toDataURL("image/png");
      // 失敗時はブラウザによっては空の data URL（"data:,"）が返るため内容も確認する
      if (typeof url === "string" && url.startsWith("data:image/") && url.length > 512) {
        dataUrl = url;
      }
    } catch {
      dataUrl = null;
    }

    const shotIndex = index;
    // useFrame（レンダリングループ内）から親の state を直接更新すると競合するため、次のタスクへ回す
    window.setTimeout(() => {
      onCapture(projectId, dataUrl);
      if (shotIndex + 1 >= projectIds.length) onComplete();
      else setIndex(shotIndex + 1);
    }, 0);
  });

  if (projectId === undefined) return null;

  return (
    <>
      {/* variant="thumbnail" では SiteScene が背景を省くため、撮影結果が透過しないよう
          ここで通常ビューと同じ空の色を与える。 */}
      <color attach="background" args={[SCENE_COLORS.sky]} />
      <ThumbnailFraming projectId={projectId} />
      <SiteScene projectId={projectId} variant="thumbnail" />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * エラーバウンダリ
 * ------------------------------------------------------------------ */

interface CaptureBoundaryProps {
  onError: (message: string) => void;
  children: ReactNode;
}

interface CaptureBoundaryState {
  failed: boolean;
}

/**
 * WebGL コンテキストの生成失敗（`<Canvas>` が render 中に throw する）を握る。
 * 失敗しても呼び出し側は写真フォールバックで表示を継続する。
 */
class CaptureBoundary extends Component<CaptureBoundaryProps, CaptureBoundaryState> {
  constructor(props: CaptureBoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): CaptureBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.props.onError(message);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/* ------------------------------------------------------------------ *
 * 公開
 * ------------------------------------------------------------------ */

export interface CaptureRigProps {
  projectIds: string[];
  /** 撮影キャンバスの大きさ (CSS px) */
  width: number;
  height: number;
  settleFrames?: number;
  minSettleMs?: number;
  /** 先頭から何件を「写真読込直後」として長めに待つか */
  warmupTiles?: number;
  /** 先頭タイルの最低待ち時間 (ms) */
  warmupSettleMs?: number;
  /** 1件撮影するたびに呼ばれる。dataUrl が null なら撮影失敗。 */
  onCapture: (projectId: string, dataUrl: string | null) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

/**
 * 画面外の撮影用 Canvas。UI には見せない（`position: fixed; left: -10000px`）。
 */
export function CaptureRig({
  projectIds,
  width,
  height,
  settleFrames = 6,
  minSettleMs = 220,
  warmupTiles = 2,
  warmupSettleMs = 600,
  onCapture,
  onComplete,
  onError,
}: CaptureRigProps): ReactElement | null {
  if (projectIds.length === 0) return null;

  return (
    <div className={styles.offscreen} style={{ width, height }} aria-hidden="true">
      <CaptureBoundary onError={onError}>
        {/* 実際の画角は各案件について ThumbnailFraming が siteCameraFor() で設定する。
            ここは初回フレーム用の既定値。 */}
        <Canvas
          frameloop="always"
          dpr={1}
          shadows={false}
          camera={{ position: [-140, 96, 150], fov: 45, near: 0.5, far: 8000 }}
          gl={{ preserveDrawingBuffer: true, antialias: true, powerPreference: "low-power" }}
        >
          <CaptureController
            projectIds={projectIds}
            settleFrames={settleFrames}
            minSettleMs={minSettleMs}
            warmupTiles={warmupTiles}
            warmupSettleMs={warmupSettleMs}
            onCapture={onCapture}
            onComplete={onComplete}
          />
        </Canvas>
      </CaptureBoundary>
    </div>
  );
}
