"use client";

/**
 * 3Dギャラリーの1タイル。
 *
 * - 既定は生成済みの **3Dプレビュー画像**（data URL）を表示する。
 * - 3Dを生成できなかった現場は **サンプル写真**（`visual.thumbnailUrl`）へフォールバックする。
 * - 3D表示のときは、並べて比較できるようサンプル写真を右下に小さく重ねる。
 * - 写真を出す場合は CC ライセンス遵守のため必ずクレジットを表示する。
 */
import type { ReactElement } from "react";

import { STATUS_PILL_CLASS } from "@/components/project/statusPill";
import { PROJECT_STATUS_LABEL, type Project } from "@/lib/schemas/project";
import styles from "./Site3DGallery.module.css";

/** タイル画像の論理サイズ（撮影キャンバスと揃える） */
export const THUMB_WIDTH = 480;
export const THUMB_HEIGHT = 300;

export interface SiteThumbnailProps {
  project: Project;
  /** 生成済みの3Dプレビュー（data URL）。null ならサンプル写真を表示する。 */
  previewUrl: string | null;
  selected: boolean;
  onSelect: (projectId: string) => void;
}

export function SiteThumbnail({
  project,
  previewUrl,
  selected,
  onSelect,
}: SiteThumbnailProps): ReactElement {
  const credit = project.visual.thumbnailCredit;
  const has3d = Boolean(previewUrl);
  const imageUrl = previewUrl ?? project.visual.thumbnailUrl;

  return (
    <li className={styles.cell}>
      <figure className={`${styles.tile} ${selected ? styles.tileSelected : ""}`}>
        <button
          type="button"
          className={styles.button}
          onClick={() => onSelect(project.id)}
          aria-pressed={selected}
          aria-label={`${project.publicTitle}（${project.location.municipality}）の3D表示を選択`}
          title={project.publicTitle}
        >
          <span className={styles.media}>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL と /public/images の静的画像を、外部最適化に依存せず即時表示するため */}
            <img
              className={styles.image}
              src={imageUrl}
              alt={
                has3d
                  ? `${project.publicTitle}の3Dプレビュー（サンプルデータ）`
                  : `${project.publicTitle}の工事イメージ写真（サンプル）`
              }
              width={THUMB_WIDTH}
              height={THUMB_HEIGHT}
              loading="lazy"
              decoding="async"
            />
            <span className={`${styles.badge} ${has3d ? styles.badge3d : ""}`}>
              {has3d ? "3D" : "写真"}
            </span>
            {has3d ? (
              <span className={styles.mini} aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element -- 3Dと並べるサンプル写真（data URL ではない静的画像） */}
                <img
                  src={project.visual.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  width={160}
                  height={100}
                />
              </span>
            ) : null}
          </span>
        </button>

        <figcaption className={styles.caption}>
          <span className={styles.pillRow}>
            <span className={`pill ${STATUS_PILL_CLASS[project.status]}`}>
              {PROJECT_STATUS_LABEL[project.status]}
            </span>
          </span>
          <span className={styles.title}>{project.publicTitle}</span>
          <span className={styles.meta}>
            <span className={styles.category}>{project.category}</span>
            <span className={styles.municipality} title={project.location.municipality}>
              {project.location.municipality}
            </span>
          </span>
          {credit ? (
            <span className={styles.credit}>
              写真: {credit.author} / {credit.license}{" "}
              <a href={credit.url} target="_blank" rel="noopener noreferrer">
                原典
              </a>
            </span>
          ) : (
            <span className={styles.credit}>写真クレジット情報なし（開発用サンプル画像）</span>
          )}
        </figcaption>
      </figure>
    </li>
  );
}
