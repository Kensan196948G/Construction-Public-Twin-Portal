"use client";

/**
 * 現場ギャラリー（全画面オーバーレイ）。
 *
 * 旧「写真24件の一覧」を廃し、**24現場それぞれの3D表示**へ置き換えたもの。
 *   - 「3Dギャラリー」タブ: 24現場の3Dプレビュー（Site3DGallery）
 *   - 「現場詳細」タブ: 選択現場の3D（SiteScene）+ サンプル写真 + 基本情報
 *
 * 3D が使えない環境でも写真とテキストは必ず表示される。
 */
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useState, type ReactElement } from "react";

import { Site3DGallery } from "@/components/gallery/Site3DGallery";
import { SiteScene } from "@/components/viewer/SiteScene";
import { publicProjects, getProjectById } from "@/lib/data/projects";
import { SITE_TYPE_LABEL, PROJECT_STATUS_LABEL } from "@/lib/schemas/project";
import { SITE_LAYER_NOTE, buildSiteModelData } from "@/lib/site/sceneData";
import { useAppStore } from "@/lib/store/useAppStore";
import { formatDate, formatDateTime, pad2String } from "./format";
import { IconClose, IconExt } from "./icons";
import { STATUS_PILL_CLASS } from "./statusPill";
import styles from "./SiteViewer.module.css";

type Tab = "gallery" | "detail";

/** 現場3Dの推奨カメラ（現場の寸法から距離を決める） */
function siteCameraFor(projectId: string) {
  const project = getProjectById(projectId);
  if (!project) {
    return { position: [0, 60, 120] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: 45 };
  }
  const data = buildSiteModelData(project);
  const extent = Math.max(data.width, data.depth);
  const dist = extent * 1.25 + 30;
  return {
    position: [dist * 0.72, dist * 0.62, dist * 0.72] as [number, number, number],
    target: [0, Math.max(2, data.height * 0.35), 0] as [number, number, number],
    fov: 45,
  };
}

/** 3D を描けない環境でも写真・情報が残るよう、エラーを握って表示を継続する */
function Safe3D({ projectId }: { projectId: string }) {
  const [failed, setFailed] = useState(false);
  const camera = useMemo(() => siteCameraFor(projectId), [projectId]);

  useEffect(() => {
    // WebGL が使えない環境を先に検出する（例外を投げない）
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);

  if (failed) {
    return (
      <div className={styles.stage3dError}>
        <p>
          この端末では3Dを表示できません。
          <br />
          右側のサンプル写真と工事情報は引き続き確認できます。
        </p>
      </div>
    );
  }

  return (
    <>
      <span className={styles.badge}>現場3D（サンプルデータ）</span>
      <Canvas
        dpr={[1, 2]}
        shadows={false}
        camera={{ position: camera.position, fov: camera.fov ?? 45, near: 0.5, far: 8000 }}
        onCreated={({ camera: cam }) => cam.lookAt(...camera.target)}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <SiteScene projectId={projectId} variant="full" />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          target={camera.target}
          minDistance={15}
          maxDistance={1400}
          maxPolarAngle={Math.PI / 2.05}
        />
      </Canvas>
    </>
  );
}

export function SiteViewer(): ReactElement | null {
  const open = useAppStore((s) => s.siteViewerOpen);
  const siteViewerIndex = useAppStore((s) => s.siteViewerIndex);
  const setSiteViewerIndex = useAppStore((s) => s.setSiteViewerIndex);
  const closeSiteViewer = useAppStore((s) => s.closeSiteViewer);
  const selectProject = useAppStore((s) => s.selectProject);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);

  const [tab, setTab] = useState<Tab>("gallery");

  const order = useMemo(() => publicProjects(), []);

  // 開いた瞬間に選択中の案件へインデックスを合わせる
  useEffect(() => {
    if (!open) return;
    const position = order.findIndex((p) => p.id === selectedProjectId);
    if (position >= 0 && order[siteViewerIndex]?.id !== selectedProjectId) {
      setSiteViewerIndex(position);
    }
  }, [open, order, siteViewerIndex, selectedProjectId, setSiteViewerIndex]);

  const index =
    order.length === 0 ? 0 : Math.min(Math.max(siteViewerIndex, 0), order.length - 1);
  const project = order[index] ?? null;

  const step = (delta: number) => {
    if (order.length === 0) return;
    const next = Math.min(Math.max(index + delta, 0), order.length - 1);
    setSiteViewerIndex(next);
    selectProject(order[next].id);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSiteViewer();
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!open) return null;

  const credit = project?.visual.thumbnailCredit;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="site-viewer-title">
      <header className={styles.head}>
        <div>
          <h2 id="site-viewer-title">現場ギャラリー</h2>
          <p>
            1現場につき1つの3D表示（全 <span className="num">{order.length}</span> 現場）。
            写真は Wikimedia Commons のサンプル素材です。
          </p>
        </div>
        <div className={styles.headRight}>
          <div className={styles.nav}>
            <button
              type="button"
              className="icon-btn"
              onClick={() => step(-1)}
              disabled={index <= 0}
              aria-label="前の現場"
              title="前の現場 (←)"
            >
              ‹
            </button>
            <span className={styles.count}>
              <span className="num">{pad2String(index + 1)}</span> /{" "}
              <span className="num">{pad2String(order.length)}</span>
            </span>
            <button
              type="button"
              className="icon-btn"
              onClick={() => step(1)}
              disabled={index >= order.length - 1}
              aria-label="次の現場"
              title="次の現場 (→)"
            >
              ›
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={closeSiteViewer}
              aria-label="閉じる"
              title="閉じる (Esc)"
              autoFocus
            >
              <IconClose />
            </button>
          </div>
        </div>
      </header>

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "gallery"}
          className={`${styles.tab} ${tab === "gallery" ? styles.tabActive : ""}`}
          onClick={() => setTab("gallery")}
        >
          3Dギャラリー（{order.length}）
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "detail"}
          className={`${styles.tab} ${tab === "detail" ? styles.tabActive : ""}`}
          onClick={() => setTab("detail")}
        >
          現場詳細
        </button>
      </div>

      <div className={styles.body}>
        {order.length === 0 ? (
          <p className={styles.empty}>表示できる現場がありません。</p>
        ) : tab === "gallery" ? (
          <div className={styles.galleryWrap}>
            <Site3DGallery
              selectedProjectId={project?.id ?? null}
              onSelect={(id) => {
                const position = order.findIndex((p) => p.id === id);
                if (position >= 0) setSiteViewerIndex(position);
                selectProject(id);
              }}
            />
          </div>
        ) : project ? (
          <div className={styles.detail}>
            <div className={styles.stage3d}>
              <Safe3D projectId={project.id} />
            </div>

            <div className={styles.side}>
              <figure className={styles.photoCard}>
                {/* eslint-disable-next-line @next/next/no-img-element -- /public/images の静的画像。外部最適化に依存させない */}
                <img
                  src={project.visual.thumbnailUrl}
                  alt={`${project.name}の工事イメージ写真（サンプル）`}
                  loading="lazy"
                />
                <figcaption>
                  {credit ? (
                    <>
                      写真: <b>{credit.author}</b> / {credit.license}
                      <br />
                      <a href={credit.url} target="_blank" rel="noopener noreferrer">
                        原典: Wikimedia Commons
                        <IconExt />
                      </a>
                      （この工事の現場写真ではありません）
                    </>
                  ) : (
                    <span>クレジット情報なし（開発用サンプル画像）</span>
                  )}
                </figcaption>
              </figure>

              <div className={styles.metaCard}>
                <div className={styles.tags}>
                  <span className={`pill ${STATUS_PILL_CLASS[project.status]}`}>
                    {PROJECT_STATUS_LABEL[project.status]}
                  </span>
                  <span className="pill cat">{SITE_TYPE_LABEL[project.siteType]}</span>
                  <span className="pill cat">{project.category}</span>
                </div>
                <h3>{project.name}</h3>
                <p className={styles.lead}>{project.publicTitle}</p>
                <dl className={styles.dl}>
                  <div>
                    <dt>所在地</dt>
                    <dd>{project.location.address}</dd>
                  </div>
                  <div>
                    <dt>工期</dt>
                    <dd className="num">
                      {formatDate(project.schedule.startDate)} 〜{" "}
                      {formatDate(project.schedule.plannedEndDate)}
                    </dd>
                  </div>
                  <div>
                    <dt>発注者</dt>
                    <dd>{project.owner.name}</dd>
                  </div>
                  <div>
                    <dt>施工者</dt>
                    <dd>{project.contractor.name}</dd>
                  </div>
                  <div>
                    <dt>現在の工程</dt>
                    <dd>{project.schedule.phase}</dd>
                  </div>
                  <div>
                    <dt>最終更新</dt>
                    <dd className="num">{formatDateTime(project.schedule.lastUpdatedAt)}</dd>
                  </div>
                </dl>
              </div>

              <p className={styles.note}>{SITE_LAYER_NOTE}</p>
            </div>
          </div>
        ) : (
          <p className={styles.empty}>現場を選んでください。</p>
        )}
      </div>
    </div>
  );
}
