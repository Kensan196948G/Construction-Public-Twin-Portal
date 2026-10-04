"use client";

import { useMemo, type ReactElement } from "react";

import { impactsForProject } from "@/lib/data/impacts";
import { getProjectById, getProjectBySlug, publicProjects } from "@/lib/data/projects";
import { isImpactActiveAt, type ImpactType } from "@/lib/schemas/impact";
import {
  COMPLETION_TYPE_LABEL,
  PROJECT_STATUS_LABEL,
  SITE_TYPE_LABEL,
  type ProjectStatus,
} from "@/lib/schemas/project";
import { useAppStore, type CompletionMode } from "@/lib/store/useAppStore";

import { Disclaimer } from "./Disclaimer";
import { IconAlert, IconCheck, IconExt, IconPin } from "./icons";
import { ImpactPanel } from "./ImpactPanel";
import { OfficialSourceLink } from "./OfficialSourceLink";
import { ProjectTimeline } from "./ProjectTimeline";
import { formatDate, formatDateTime } from "./format";
import styles from "./project.module.css";
import { STATUS_PILL_CLASS } from "./statusPill";

/** ヒーロー上端の 3px バーの色（施工状態）。 */
const HERO_CLASS: Record<ProjectStatus, string> = {
  planned: styles.heroPlanned,
  under_construction: styles.heroActive,
  completed: styles.heroDone,
  suspended: styles.heroHold,
};

/** 「規制中」バッジの対象となる影響種別。 */
const REGULATING_TYPES: readonly ImpactType[] = [
  "lane_closure",
  "road_closure",
  "sidewalk_switch",
  "detour",
  "access_restriction",
];

const COMPLETION_OPTIONS: { mode: CompletionMode; label: string }[] = [
  { mode: "current", label: "現在" },
  { mode: "planned", label: "完成予想" },
  { mode: "compare", label: "比較" },
];

/**
 * 選択中工事の詳細カード。
 * `projectId`（id または slug）が見つからない場合は null を返し、
 * 空状態の表示は呼び出し側（app/page.tsx / MobileProjectSheet）に任せる。
 */
export function ProjectDetailCard({ projectId }: { projectId: string }): ReactElement | null {
  const viewTime = useAppStore((s) => s.viewTime);
  const selectedImpactId = useAppStore((s) => s.selectedImpactId);
  const selectImpact = useAppStore((s) => s.selectImpact);
  const completionMode = useAppStore((s) => s.completionMode);
  const setCompletionMode = useAppStore((s) => s.setCompletionMode);
  const openSiteViewer = useAppStore((s) => s.openSiteViewer);

  const project = useMemo(
    () => getProjectById(projectId) ?? getProjectBySlug(projectId) ?? null,
    [projectId],
  );

  const impacts = useMemo(() => (project ? impactsForProject(project.id) : []), [project]);
  const viewDate = useMemo(() => new Date(viewTime), [viewTime]);
  const activeImpacts = useMemo(
    () => impacts.filter((i) => isImpactActiveAt(i, viewDate)),
    [impacts, viewDate],
  );
  const regulating = activeImpacts.some((i) => REGULATING_TYPES.includes(i.type));
  /** 現場ビューアの並び（publicProjects 順）での位置。 */
  const viewerIndex = useMemo(
    () => (project ? publicProjects().findIndex((p) => p.id === project.id) : -1),
    [project],
  );

  if (!project) return null;

  const { location, schedule, source, visual } = project;
  const status = project.status;

  return (
    <article className={styles.detail} aria-label={`${project.publicTitle} の工事詳細`}>
      {/* ---------------- ヒーロー ---------------- */}
      <header className={`${styles.dHero} ${HERO_CLASS[status]}`}>
        <div className={styles.dTags}>
          <span className={`pill ${STATUS_PILL_CLASS[status]}`}>
            {PROJECT_STATUS_LABEL[status]}
          </span>
          <span className="pill cat">{project.category}</span>
          <span className="pill cat">{SITE_TYPE_LABEL[project.siteType]}</span>
          {regulating && (
            <span className="pill reg">
              <IconAlert />
              規制中
            </span>
          )}
        </div>

        <h1 className={styles.dTitle}>{project.publicTitle}</h1>
        <div className={styles.dFormal}>{project.name}</div>

        <div className={styles.dMeta}>
          <div className={styles.dMetaFull}>
            <div className={styles.k}>所在地</div>
            <div className={`${styles.v} ${styles.vInline}`}>
              <IconPin />
              <span>
                {location.postalCode ? `〒${location.postalCode} ` : ""}
                {location.address}
              </span>
            </div>
          </div>

          <div>
            <div className={styles.k}>工期</div>
            <div className={`${styles.v} num`}>
              {formatDate(schedule.startDate)}
              <small>〜 {formatDate(schedule.plannedEndDate)}</small>
            </div>
          </div>

          <div>
            <div className={styles.k}>現在の状態</div>
            <div className={styles.v}>{PROJECT_STATUS_LABEL[status]}</div>
          </div>

          <div>
            <div className={styles.k}>現在の工程</div>
            <div className={styles.v}>{schedule.phase}</div>
          </div>

          <div>
            <div className={styles.k}>発注者</div>
            <div className={styles.v}>{project.owner.name}</div>
          </div>

          <div>
            <div className={styles.k}>施工者</div>
            <div className={styles.v}>{project.contractor.name}</div>
          </div>

          <div className={styles.dMetaFull}>
            <div className={styles.k}>最終更新（この情報の更新日時）</div>
            <div className={`${styles.v} num`}>{formatDateTime(schedule.lastUpdatedAt)}</div>
          </div>
        </div>
      </header>

      {/* ---------------- 目的・整備内容 ---------------- */}
      <section className={styles.dSec}>
        <h3>目的 / PURPOSE</h3>
        <p className={styles.lead}>{project.purpose}</p>
        <h3 className={styles.h3Spaced}>整備内容 / SCOPE</h3>
        <ul className={styles.benefits}>
          {project.benefits.map((benefit) => (
            <li key={benefit}>
              <IconCheck />
              <span>{benefit}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------- 完成予想の切替 ---------------- */}
      <section className={styles.dSec}>
        <h3>完成予想 / COMPLETION</h3>
        <div className="seg" role="group" aria-label="完成予想の表示切替">
          {COMPLETION_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              className={completionMode === option.mode ? "active" : ""}
              aria-pressed={completionMode === option.mode}
              onClick={() => setCompletionMode(option.mode)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className={styles.note}>
          完成予想モデル: <b>{COMPLETION_TYPE_LABEL[visual.completionType]}</b>
          （3D 表示に反映されます）
        </p>
      </section>

      {/* ---------------- 工区 ---------------- */}
      <section className={styles.dSec}>
        <h3>工区 / WORK ZONE</h3>
        <dl className={styles.zoneList}>
          <div>
            <dt>自治体</dt>
            <dd>{location.municipality}</dd>
          </div>
          {location.postalCode && (
            <div>
              <dt>郵便番号</dt>
              <dd className="num">〒{location.postalCode}</dd>
            </div>
          )}
          <div>
            <dt>都道府県・市区町村</dt>
            <dd>{[location.prefecture, location.city, location.ward].filter(Boolean).join(" ")}</dd>
          </div>
          <div>
            <dt>町名</dt>
            <dd>{location.town}</dd>
          </div>
          <div>
            <dt>中心座標</dt>
            <dd className="num">
              {location.center.latitude.toFixed(5)}, {location.center.longitude.toFixed(5)}
            </dd>
          </div>
          <div>
            <dt>工区データ</dt>
            <dd className="mono">{location.workZoneGeoJsonUrl}</dd>
          </div>
        </dl>
      </section>

      {/* ---------------- 交通規制・影響 ---------------- */}
      <section className={styles.dSec} id="impact-section">
        <h3>
          交通規制・影響 / IMPACTS
          <span className={styles.secCount}>
            有効 {activeImpacts.length} / 全 {impacts.length} 件
          </span>
        </h3>
        <ImpactPanel
          impacts={impacts}
          viewTime={viewTime}
          selectedImpactId={selectedImpactId}
          onSelectImpact={selectImpact}
        />
      </section>

      {/* ---------------- 工期タイムライン ---------------- */}
      <section className={styles.dSec}>
        <h3>工期と規制の見通し / TIMELINE</h3>
        <ProjectTimeline project={project} impacts={impacts} viewTime={viewTime} />
      </section>

      {/* ---------------- 写真（クレジット必須） ---------------- */}
      <section className={styles.dSec}>
        <h3>サンプル写真 / PHOTO</h3>
        <figure className={styles.photoCard}>
          {/* eslint-disable-next-line @next/next/no-img-element -- /public/images の静的画像。next/image の追加設定を持ち込まない */}
          <img
            src={visual.thumbnailUrl}
            alt={`${project.name}の工事イメージ写真（サンプル）`}
            width={800}
            height={500}
            loading="lazy"
          />
          <figcaption>
            <b>{project.name}</b> の工事イメージ（サンプル写真）。
            {visual.thumbnailCredit ? (
              <>
                {" "}
                写真: <b>{visual.thumbnailCredit.author}</b> / {visual.thumbnailCredit.license}（
                <a href={visual.thumbnailCredit.url} target="_blank" rel="noopener noreferrer">
                  原典: Wikimedia Commons
                  <IconExt />
                </a>
                ）
              </>
            ) : (
              " クレジット情報なし（開発用サンプル画像）"
            )}
          </figcaption>
        </figure>
        {viewerIndex >= 0 && (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost} ${styles.photoOpen}`}
            onClick={() => openSiteViewer(viewerIndex)}
          >
            現場ビューアで拡大
          </button>
        )}
      </section>

      {/* ---------------- 出典 ---------------- */}
      <section className={styles.dSec}>
        <h3>出典 / SOURCE</h3>
        <OfficialSourceLink
          provider={source.provider}
          officialUrl={source.officialUrl}
          verifiedAt={source.verifiedAt}
          dataset={source.dataset}
          license={source.license}
        />
      </section>

      {/* ---------------- ご注意 ---------------- */}
      <section className={styles.dSec}>
        <h3>ご注意 / NOTICE</h3>
        <Disclaimer text={project.disclaimer} />
      </section>
    </article>
  );
}
