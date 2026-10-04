"use client";

import { useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";

import { publicProjects } from "@/lib/data/projects";
import { PROJECT_STATUS_LABEL, SITE_TYPE_LABEL } from "@/lib/schemas/project";
import { useAppStore } from "@/lib/store/useAppStore";

import { IconClose, IconExt } from "./icons";
import { formatDate, formatDateTime, pad2String } from "./format";
import styles from "./project.module.css";
import { STATUS_PILL_CLASS } from "./statusPill";

/**
 * 現場ビューア（全画面）。
 * - ストアの `siteViewerOpen` が false なら null。
 * - 並び順は `publicProjects()`（全公開案件・状態順）。
 *   `siteViewerIndex` がその並びの位置で、前後ナビは `setSiteViewerIndex()` を使う。
 * - 写真は `visual.thumbnailUrl`、クレジットは `visual.thumbnailCredit`
 *   （作者・ライセンス・原典 URL）を必ず表示する（CC ライセンス遵守）。
 */
export function SiteViewer(): ReactElement | null {
  const open = useAppStore((s) => s.siteViewerOpen);
  const siteViewerIndex = useAppStore((s) => s.siteViewerIndex);
  const setSiteViewerIndex = useAppStore((s) => s.setSiteViewerIndex);
  const closeSiteViewer = useAppStore((s) => s.closeSiteViewer);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const selectProject = useAppStore((s) => s.selectProject);

  const order = useMemo(() => publicProjects(), []);

  // 開いた瞬間だけ、表示位置を選択中の案件に合わせる（以降はユーザー操作を尊重する）
  const synced = useRef(false);
  useEffect(() => {
    if (!open) {
      synced.current = false;
      return;
    }
    if (synced.current) return;
    synced.current = true;
    const position = order.findIndex((p) => p.id === selectedProjectId);
    if (position >= 0 && order[siteViewerIndex]?.id !== selectedProjectId) {
      setSiteViewerIndex(position);
    }
  }, [open, order, siteViewerIndex, selectedProjectId, setSiteViewerIndex]);

  const index =
    order.length === 0 ? 0 : Math.min(Math.max(siteViewerIndex, 0), order.length - 1);
  const project = order[index] ?? null;

  const step = useCallback(
    (delta: number) => {
      if (order.length === 0) return;
      const next = Math.min(order.length - 1, Math.max(0, index + delta));
      setSiteViewerIndex(next);
      selectProject(order[next].id);
    },
    [order, index, setSiteViewerIndex, selectProject],
  );

  // Esc で閉じる / ←→ で前後の現場
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSiteViewer();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeSiteViewer, step]);

  if (!open || !project) return null;

  const credit = project.visual.thumbnailCredit;

  return (
    <div
      className={styles.siteviewer}
      role="dialog"
      aria-modal="true"
      aria-labelledby="site-viewer-title"
    >
      <header className={styles.svHead}>
        <div>
          <h2 id="site-viewer-title">現場ビューア</h2>
          <p>
            1現場ずつ切り出した写真と基本情報（全 <span className="num">{order.length}</span> 件・
            開発用サンプルデータ）
          </p>
        </div>
        <div className={styles.svNav}>
          <button
            type="button"
            className="icon-btn"
            onClick={() => step(-1)}
            disabled={index <= 0}
            aria-label="前の現場"
            title="前の現場"
          >
            ‹
          </button>
          <span className={styles.svCount}>
            <span className="num">{pad2String(index + 1)}</span> /{" "}
            <span className="num">{pad2String(order.length)}</span>
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => step(1)}
            disabled={index >= order.length - 1}
            aria-label="次の現場"
            title="次の現場"
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
      </header>

      <div className={styles.svBody}>
        <aside className={styles.svList} aria-label="現場一覧">
          {order.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.svItem} ${i === index ? styles.svItemActive : ""}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => {
                setSiteViewerIndex(i);
                selectProject(item.id);
              }}
            >
              <span className={styles.svDot} data-status={item.status} aria-hidden="true" />
              <span className={styles.svIt}>
                <span className={styles.svIname}>{item.name}</span>
                <span className={styles.svIloc}>{item.location.address}</span>
              </span>
              <span className={styles.svItype}>{item.category}</span>
            </button>
          ))}
        </aside>

        <div className={styles.svStage}>
          <figure className={styles.svPhoto}>
            <div className={styles.svPhotoImg}>
              {/* eslint-disable-next-line @next/next/no-img-element -- /public/images の静的画像。next/image の追加設定を持ち込まない */}
              <img
                src={project.visual.thumbnailUrl}
                alt={`${project.name}の工事イメージ写真（サンプル）`}
              />
            </div>
            <figcaption className={styles.svCredit}>
              {credit ? (
                <>
                  <span>
                    写真: <b>{credit.author}</b> / {credit.license}
                  </span>
                  <a href={credit.url} target="_blank" rel="noopener noreferrer">
                    原典: Wikimedia Commons
                    <IconExt />
                  </a>
                </>
              ) : (
                <span>クレジット情報なし（開発用サンプル画像）</span>
              )}
            </figcaption>
          </figure>

          <div className={styles.svMeta}>
            <div className={styles.svMtags}>
              <span className={`pill ${STATUS_PILL_CLASS[project.status]}`}>
                {PROJECT_STATUS_LABEL[project.status]}
              </span>
              <span className="pill cat">{SITE_TYPE_LABEL[project.siteType]}</span>
              <span className="pill cat">{project.category}</span>
            </div>
            <h3>{project.name}</h3>
            <p className={styles.svMlead}>{project.publicTitle}</p>
            <dl className={styles.svMdl}>
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
        </div>
      </div>
    </div>
  );
}
