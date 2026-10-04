"use client";

/**
 * 24現場それぞれの **3Dビュー** を並べるギャラリー。
 *
 * 旧「写真24件の一覧」を置き換えるもの。1現場 = 1つの3D画像として表示し、
 * 併せてサンプル写真（Wikimedia Commons 素材・クレジット付き）も見せる。
 *
 * ■ 生成方式（性能要件）
 *   24個の `<Canvas>` を同時生成すると WebGL コンテキスト上限（概ね16）を超えて破綻する。
 *   そこで画面外の撮影専用 Canvas **1つ** で案件を順に描画し、`toDataURL()` で
 *   PNG 化したものを `<img>` として並べる（詳細は `CaptureRig.tsx`）。
 *   生成は 1件ずつ `setTimeout` で分割し、UI をブロックしない。進捗を表示する。
 *
 * ■ フォールバック
 *   WebGL 不可 / 撮影失敗 / タイムアウトのいずれでも例外を投げず、
 *   その現場の `visual.thumbnailUrl`（サンプル写真）を表示する。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { publicProjects } from "@/lib/data/projects";
import { SITE_LAYER_NOTE } from "@/lib/site/sceneData";
import { useAppStore } from "@/lib/store/useAppStore";
import { CaptureRig } from "./CaptureRig";
import { SiteThumbnail, THUMB_HEIGHT, THUMB_WIDTH } from "./SiteThumbnail";
import styles from "./Site3DGallery.module.css";

/** 撮影キャンバスの大きさ（タイルと同じ 8:5） */
const CAPTURE_WIDTH = THUMB_WIDTH;
const CAPTURE_HEIGHT = THUMB_HEIGHT;

/** 1件も撮影できずに経過したら諦める（タブ非表示中は数えない） */
const CAPTURE_TIMEOUT_MS = 20_000;

/** 連続して Canvas が落ちた場合に再試行する上限 */
const MAX_CAPTURE_FAILURES = 4;

const WEBGL_UNAVAILABLE_MESSAGE =
  "この環境では WebGL を利用できないため、3Dプレビューを生成できません。各現場のサンプル写真を表示しています。";

/**
 * 生成済みプレビューのキャッシュ（ページ生存中のみ）。
 * タブを開き直すたびに24枚を作り直さないための最小限の仕組み。
 */
const previewCache = new Map<string, string | null>();
let previewCacheComplete = false;

type Status = "running" | "done";

export interface Site3DGalleryProps {
  /** タイル選択時。未指定なら `selectProject(projectId)` を呼ぶ。 */
  onSelect?: (projectId: string) => void;
  /** 選択中として強調する案件ID */
  selectedProjectId?: string | null;
}

/** WebGL コンテキストが得られなかった場合のエラー文言を、利用者向けの日本語へ寄せる */
function friendlyErrorMessage(message: string): string {
  if (/webgl|context/i.test(message)) return WEBGL_UNAVAILABLE_MESSAGE;
  return `3Dプレビューの生成を継続できませんでした。生成できた現場は3D、残りはサンプル写真で表示しています。（${message}）`;
}

export function Site3DGallery({
  onSelect,
  selectedProjectId,
}: Site3DGalleryProps): ReactElement {
  const projects = useMemo(() => publicProjects(), []);
  const storeSelectedId = useAppStore((s) => s.selectedProjectId);
  const selectProject = useAppStore((s) => s.selectProject);

  const [shots, setShots] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(previewCache),
  );
  // 生成はマウント時に1度だけ開始する。effect から setState すると
  // カスケードレンダリングになるため、初期値の時点で決める。
  // WebGL が使えない環境は <Canvas> の生成失敗として下の error boundary が受け止める。
  const [status, setStatus] = useState<Status>(() =>
    previewCacheComplete || projects.length === 0 ? "done" : "running",
  );
  const [queue, setQueue] = useState<string[] | null>(() =>
    previewCacheComplete || projects.length === 0 ? null : projects.map((p) => p.id),
  );
  const [runKey, setRunKey] = useState(0);
  const [progress, setProgress] = useState(() => (previewCacheComplete ? projects.length : 0));
  const [notice, setNotice] = useState<string | null>(null);

  /** 撮影が完了した累計件数 */
  const completedRef = useRef(0);
  /** 現在の Canvas で撮影が完了した件数 */
  const capturedInRun = useRef(0);
  /** Canvas が落ちた回数 */
  const failures = useRef(0);

  /* ---------------------------------------------------------------- *
   * 撮影結果の取り込み
   * ---------------------------------------------------------------- */
  const handleCapture = useCallback((projectId: string, dataUrl: string | null) => {
    previewCache.set(projectId, dataUrl);
    setShots((prev) => ({ ...prev, [projectId]: dataUrl }));
    capturedInRun.current += 1;
    completedRef.current += 1;
    setProgress(completedRef.current);
  }, []);

  const handleComplete = useCallback(() => {
    previewCacheComplete = true;
    completedRef.current = projects.length;
    setProgress(projects.length);
    setQueue(null);
    setStatus("done");
  }, [projects.length]);

  /**
   * Canvas 全体が落ちた場合。失敗した1件を写真表示に固定し、
   * 残りを新しい Canvas で再開する（上限まで）。
   */
  const handleRigError = useCallback(
    (message: string) => {
      const current = queue ?? [];
      const failedIndex = Math.min(capturedInRun.current, Math.max(0, current.length - 1));
      const failedId = current[failedIndex];

      if (failedId) {
        previewCache.set(failedId, null);
        setShots((prev) => ({ ...prev, [failedId]: null }));
        completedRef.current += 1;
        setProgress(completedRef.current);
      }

      failures.current += 1;
      const remaining = current.slice(failedIndex + (failedId ? 1 : 0));

      if (failures.current >= MAX_CAPTURE_FAILURES || remaining.length === 0) {
        setNotice(friendlyErrorMessage(message));
        setQueue(null);
        setStatus("done");
        return;
      }

      capturedInRun.current = 0;
      setQueue(remaining);
      setRunKey((key) => key + 1);
    },
    [queue],
  );

  /* ---------------------------------------------------------------- *
   * 停滞したら諦める（タブ非表示中は停止扱いにする）
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (status !== "running") return;
    let timer = 0;

    const arm = () => {
      window.clearTimeout(timer);
      if (document.hidden) return;
      timer = window.setTimeout(() => {
        setNotice(
          "3Dプレビューの生成がタイムアウトしました。生成できた現場のみ3D、残りはサンプル写真で表示しています。",
        );
        setQueue(null);
        setStatus("done");
      }, CAPTURE_TIMEOUT_MS);
    };

    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [status, progress]);

  /* ---------------------------------------------------------------- *
   * 選択
   * ---------------------------------------------------------------- */
  const selected = selectedProjectId !== undefined ? selectedProjectId : storeSelectedId;

  const handleSelect = useCallback(
    (projectId: string) => {
      if (onSelect) onSelect(projectId);
      else selectProject(projectId);
    },
    [onSelect, selectProject],
  );

  /* ---------------------------------------------------------------- *
   * 表示
   * ---------------------------------------------------------------- */
  const renderedCount = Object.values(shots).filter(Boolean).length;
  const fallbackCount = Math.max(0, projects.length - renderedCount);
  const percent =
    projects.length === 0 ? 100 : Math.round((Math.min(progress, projects.length) / projects.length) * 100);
  const captureQueue =
    status === "running" && queue !== null && queue.length > 0 ? queue : null;

  return (
    <section className={styles.gallery} aria-label="現場の3Dギャラリー">
      <header className={styles.head}>
        <div className={styles.headText}>
          <h3 className={styles.headTitle}>3Dプレビュー（全{projects.length}現場）</h3>
          <p className={styles.headLead}>
            1現場につき1つの3D表示です。3Dは案件IDから生成したサンプル（合成）データ、
            写真は Wikimedia Commons のサンプル素材です。
          </p>
        </div>
        <div className={styles.status} role="status" aria-live="polite">
          {status === "running" ? (
            <span className={styles.statusRunning}>
              <span className={styles.dot} aria-hidden="true" />
              3Dプレビューを生成中 <span className="num">{progress}</span>/
              <span className="num">{projects.length}</span>
            </span>
          ) : (
            <span>
              3D <span className="num">{renderedCount}</span>件 ／ 写真{" "}
              <span className="num">{fallbackCount}</span>件
            </span>
          )}
        </div>
      </header>

      {status === "running" ? (
        <div className={styles.bar} aria-hidden="true">
          <span className={styles.barFill} style={{ width: `${percent}%` }} />
        </div>
      ) : null}

      {notice ? <p className={styles.notice}>{notice}</p> : null}

      <ul className={styles.grid}>
        {projects.map((project) => (
          <SiteThumbnail
            key={project.id}
            project={project}
            previewUrl={shots[project.id] ?? null}
            selected={project.id === selected}
            onSelect={handleSelect}
          />
        ))}
      </ul>

      <p className={styles.note}>{SITE_LAYER_NOTE}</p>

      {captureQueue ? (
        <CaptureRig
          key={runKey}
          projectIds={captureQueue}
          width={CAPTURE_WIDTH}
          height={CAPTURE_HEIGHT}
          onCapture={handleCapture}
          onComplete={handleComplete}
          onError={handleRigError}
        />
      ) : null}
    </section>
  );
}
