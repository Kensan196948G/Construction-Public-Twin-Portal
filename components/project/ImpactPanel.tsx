"use client";

import { useMemo } from "react";

import {
  IMPACT_SEVERITY_LABEL,
  IMPACT_TYPE_LABEL,
  impactIsPast,
  impactIsUpcoming,
  isImpactActiveAt,
  type Impact,
  type ImpactSeverity,
} from "@/lib/schemas/impact";

import { formatDate } from "./format";
import styles from "./project.module.css";

/** severity → カード左端の色クラス（.sev-pill と同じ色体系） */
const SEVERITY_CLASS: Record<ImpactSeverity, string> = {
  info: styles.impInfo,
  notice: styles.impNotice,
  warning: styles.impWarning,
};

type ImpactState = "active" | "upcoming" | "past";

const STATE_LABEL: Record<ImpactState, string> = {
  active: "期間中",
  upcoming: "実施予定",
  past: "終了",
};

const STATE_ORDER: Record<ImpactState, number> = { active: 0, upcoming: 1, past: 2 };

/**
 * 基準日（viewTime）に対して有効かどうかを判定する。
 * 有効なら "active"、これから始まるなら "upcoming"、終わっていれば "past"。
 */
function impactStateAt(impact: Impact, viewTime: Date): ImpactState {
  if (isImpactActiveAt(impact, viewTime)) return "active";
  if (impactIsUpcoming(impact, viewTime)) return "upcoming";
  if (impactIsPast(impact, viewTime)) return "past";
  return "past";
}

export interface ImpactPanelProps {
  impacts: Impact[];
  /** ストアの viewTime（ISO 文字列） */
  viewTime: string;
  selectedImpactId: string | null;
  onSelectImpact: (id: string | null) => void;
}

/**
 * 交通規制・影響イベントの一覧。
 * 種別（IMPACT_TYPE_LABEL）・重要度（sev-pill）・説明・期間・繰り返しを表示し、
 * viewTime に対して有効でないものは低不透明度（.inactive）にする（AC-008）。
 */
export function ImpactPanel({
  impacts,
  viewTime,
  selectedImpactId,
  onSelectImpact,
}: ImpactPanelProps) {
  const viewDate = useMemo(() => new Date(viewTime), [viewTime]);

  const items = useMemo(
    () =>
      impacts
        .map((impact) => ({ impact, state: impactStateAt(impact, viewDate) }))
        .sort(
          (a, b) =>
            STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
            a.impact.activeFrom.localeCompare(b.impact.activeFrom),
        ),
    [impacts, viewDate],
  );

  if (items.length === 0) {
    return <p className="empty-note">現在、交通規制の情報はありません</p>;
  }

  return (
    <ul className={styles.imp}>
      {items.map(({ impact, state }) => {
        const active = state === "active";
        const selected = impact.id === selectedImpactId;
        const className = [
          styles.impItem,
          SEVERITY_CLASS[impact.severity],
          active ? "" : styles.inactive,
          selected ? styles.impSelected : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <li key={impact.id}>
            <button
              type="button"
              className={className}
              aria-pressed={selected}
              onClick={() => onSelectImpact(selected ? null : impact.id)}
            >
              <span className={styles.impTop}>
                <span className={styles.impTitle}>{impact.title}</span>
                <span className={styles.impPills}>
                  <span className={`sev-pill ${impact.severity}`}>
                    {IMPACT_SEVERITY_LABEL[impact.severity]}
                  </span>
                  <span className="pill cat">{IMPACT_TYPE_LABEL[impact.type]}</span>
                </span>
              </span>

              <span className={styles.impDesc}>{impact.description}</span>

              <span className={styles.impPeriod}>
                <span className={active ? styles.impStateActive : styles.impState}>
                  {STATE_LABEL[state]}
                </span>
                <b>
                  {formatDate(impact.activeFrom)} 〜 {formatDate(impact.activeTo)}
                </b>
                <span>{impact.recurrence}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
