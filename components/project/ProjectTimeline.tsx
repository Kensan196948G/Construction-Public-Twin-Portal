"use client";

import { useMemo } from "react";

import { IMPACT_TYPE_LABEL, type Impact, type ImpactSeverity } from "@/lib/schemas/impact";
import type { Project } from "@/lib/schemas/project";

import { formatDate, formatMonthTick, parseDateValue } from "./format";
import styles from "./project.module.css";

const BAND_CLASS: Record<ImpactSeverity, string> = {
  info: styles.tlBandInfo,
  notice: styles.tlBandNotice,
  warning: styles.tlBandWarning,
};

export interface ProjectTimelineProps {
  project: Project;
  impacts: Impact[];
  /** ストアの viewTime（ISO 文字列） */
  viewTime: string;
}

/**
 * 工期バー（現在 = viewTime のマーカー付き）に、規制等の期間帯を重ねて表示する。
 * 横軸は「工期 + 規制期間」全体を 0〜100% に正規化する。
 */
export function ProjectTimeline({ project, impacts, viewTime }: ProjectTimelineProps) {
  const domain = useMemo(() => {
    const start = parseDateValue(project.schedule.startDate).getTime();
    const end = parseDateValue(project.schedule.plannedEndDate).getTime();
    const froms = impacts.map((i) => parseDateValue(i.activeFrom).getTime());
    const tos = impacts.map((i) => parseDateValue(i.activeTo).getTime());
    return {
      start: Math.min(start, ...froms),
      end: Math.max(end, ...tos),
    };
  }, [project, impacts]);

  const span = Math.max(1, domain.end - domain.start);

  const ticks = useMemo(
    () => Array.from({ length: 5 }, (_, i) => new Date(domain.start + (span * i) / 4)),
    [domain.start, span],
  );

  const pct = (t: number) => Math.min(100, Math.max(0, ((t - domain.start) / span) * 100));

  const workFrom = parseDateValue(project.schedule.startDate).getTime();
  const workTo = parseDateValue(project.schedule.plannedEndDate).getTime();
  const now = new Date(viewTime).getTime();
  const nowPct = pct(now);
  const nowInRange = now >= domain.start && now <= domain.end;

  // 工期バーの下に規制帯を 1 件 1 段で積む
  const trackHeight = impacts.length > 0 ? 22 + impacts.length * 7 : 22;

  const ariaLabel =
    `工期 ${formatDate(project.schedule.startDate)} から ${formatDate(project.schedule.plannedEndDate)}。` +
    `規制等 ${impacts.length} 件。基準日 ${formatDate(viewTime)}`;

  return (
    <div className={styles.tl}>
      <div className={styles.tlHead}>
        <span className={styles.tlHeadLabel}>工事期間</span>
        <span className={styles.tlNowLabel}>
          基準日 <b className="num">{formatDate(viewTime)}</b>
        </span>
      </div>

      <div
        className={styles.tlTrack}
        style={{ height: `${trackHeight}px` }}
        role="img"
        aria-label={ariaLabel}
      >
        <span
          className={styles.tlWork}
          style={{
            left: `${pct(workFrom)}%`,
            width: `${Math.max(1, pct(workTo) - pct(workFrom))}%`,
          }}
        />
        {impacts.map((impact, i) => {
          const left = pct(parseDateValue(impact.activeFrom).getTime());
          const right = pct(parseDateValue(impact.activeTo).getTime());
          return (
            <span
              key={impact.id}
              className={`${styles.tlBand} ${BAND_CLASS[impact.severity]}`}
              style={{
                left: `${left}%`,
                width: `${Math.max(1, right - left)}%`,
                top: `${18 + i * 7}px`,
              }}
              title={`${IMPACT_TYPE_LABEL[impact.type]}: ${formatDate(impact.activeFrom)} 〜 ${formatDate(impact.activeTo)}`}
            />
          );
        })}
        {nowInRange && <span className={styles.tlNow} style={{ left: `${nowPct}%` }} />}
      </div>

      <div className={styles.tlAxis}>
        {ticks.map((tick, i) => (
          <span key={i}>{formatMonthTick(tick)}</span>
        ))}
      </div>

      <ul className={styles.tlLegend}>
        <li>
          <span className={styles.tlSwWork} />
          工事期間
        </li>
        <li>
          <span className={styles.tlSwWarning} />
          重要
        </li>
        <li>
          <span className={styles.tlSwNotice} />
          注意
        </li>
        <li>
          <span className={styles.tlSwInfo} />
          参考
        </li>
      </ul>

      {!nowInRange && <p className={styles.note}>基準日は工事期間の外にあります。</p>}
    </div>
  );
}
