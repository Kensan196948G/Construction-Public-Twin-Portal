"use client";

/**
 * 工事一覧（F-002 一覧 / F-003 絞り込み）。
 *
 * 設計の正: `WebUI/koji-mieru-map-3d.html` の `.tab-body` / `.grp-head` / `.pcard`。
 * 絞り込みは `lib/data/filter.ts` の `filterProjects()`（サーバー API と同一の純粋関数）。
 */
import { useMemo, type ReactElement } from "react";

import { impactsForProject } from "@/lib/data/impacts";
import { filterProjects } from "@/lib/data/filter";
import { publicProjects } from "@/lib/data/projects";
import { isImpactActiveAt } from "@/lib/schemas/impact";
import { useAppStore } from "@/lib/store/useAppStore";

import {
  STATUS_GROUP_ORDER,
  formatPeriod,
  statusGroupColor,
  statusLabel,
  statusPillClass,
} from "./mapUi";
import styles from "./ProjectList.module.css";

export function ProjectList(): ReactElement {
  const searchKeyword = useAppStore((s) => s.searchKeyword);
  const selectedCategory = useAppStore((s) => s.selectedCategory);
  const selectedStatus = useAppStore((s) => s.selectedStatus);
  const regulatingOnly = useAppStore((s) => s.regulatingOnly);
  const viewTime = useAppStore((s) => s.viewTime);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const selectProject = useAppStore((s) => s.selectProject);
  const setStatus = useAppStore((s) => s.setStatus);
  const setCategory = useAppStore((s) => s.setCategory);
  const setSearchKeyword = useAppStore((s) => s.setSearchKeyword);
  const setRegulatingOnly = useAppStore((s) => s.setRegulatingOnly);

  const projects = useMemo(
    () =>
      filterProjects(publicProjects(), {
        keyword: searchKeyword,
        category: selectedCategory,
        status: selectedStatus,
        regulatingOnly,
        viewTime: new Date(viewTime),
      }),
    [searchKeyword, selectedCategory, selectedStatus, regulatingOnly, viewTime],
  );

  /** 施工状態ごとの見出し（該当がある状態のみ） */
  const groups = useMemo(
    () =>
      STATUS_GROUP_ORDER.map((status) => ({
        status,
        items: projects.filter((project) => project.status === status),
      })).filter((group) => group.items.length > 0),
    [projects],
  );

  const hasFilter =
    searchKeyword.trim().length > 0 ||
    selectedCategory !== null ||
    selectedStatus !== null ||
    regulatingOnly;

  function resetFilters() {
    setSearchKeyword("");
    setCategory(null);
    setStatus(null);
    setRegulatingOnly(false);
  }

  if (projects.length === 0) {
    return (
      <div className={styles.list}>
        <p className="empty-note">
          条件に合う工事はありません。検索語や絞り込み条件を変更してください。
        </p>
        {hasFilter && (
          <button type="button" className="chip-btn" onClick={resetFilters}>
            条件をクリア
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {groups.map((group) => (
        <section key={group.status} className={styles.group} aria-label={statusLabel(group.status)}>
          <div className="grp-head">
            <span
              className="gd"
              style={{ background: statusGroupColor(group.status) }}
              aria-hidden="true"
            />
            {statusLabel(group.status)}
            <span className="gn num">{group.items.length}</span>
          </div>

          {group.items.map((project) => {
            const selected = project.id === selectedProjectId;
            const activeImpacts = impactsForProject(project.id).filter((impact) =>
              isImpactActiveAt(impact, new Date(viewTime)),
            ).length;

            return (
              <button
                key={project.id}
                type="button"
                className={`${styles.card} ${selected ? styles.cardSelected : ""}`}
                aria-pressed={selected}
                data-project-id={project.id}
                onClick={() => selectProject(project.id)}
              >
                {/* ローカル配信のサンプル写真。next/image を挟まず、
                    ネットワーク遮断時でも必ず読み込めるようにする。 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={styles.thumb}
                  src={project.visual.thumbnailUrl}
                  alt={`${project.name}の工事イメージ写真（サンプル）`}
                  width={72}
                  height={54}
                  loading="lazy"
                  decoding="async"
                />

                <span className={styles.body}>
                  <span className={styles.top}>
                    <span className={styles.name}>{project.name}</span>
                    <span className={statusPillClass(project.status)}>
                      {statusLabel(project.status)}
                    </span>
                  </span>

                  <span className={styles.publicTitle}>{project.publicTitle}</span>

                  <span className={styles.meta}>
                    <span className="pill cat">{project.category}</span>
                    <span className="num">{formatPeriod(project.schedule.startDate, project.schedule.plannedEndDate)}</span>
                  </span>

                  <span className={styles.loc}>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" />
                      <circle cx="12" cy="10" r="2.5" />
                    </svg>
                    <span>{project.location.address}</span>
                  </span>

                  {activeImpacts > 0 && (
                    <span className={styles.regNote}>
                      表示中の交通規制・影響 {activeImpacts}件
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
