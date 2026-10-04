"use client";

import { useMemo, useState } from "react";

import { ProjectFilter } from "@/components/map/ProjectFilter";
import { ProjectSearch } from "@/components/map/ProjectSearch";
import { publicProjects } from "@/lib/data/projects";
import styles from "./layout.module.css";
import { HelpModal } from "./HelpModal";

/** 全公開案件のうち最も新しい更新日時 */
function latestUpdatedAt(): string | null {
  const projects = publicProjects();
  if (projects.length === 0) return null;
  return projects
    .map((p) => p.schedule.lastUpdatedAt)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

function formatUpdated(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TopBar() {
  const [helpOpen, setHelpOpen] = useState(false);
  const updated = useMemo(() => latestUpdatedAt(), []);

  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 20h20" />
            <path d="M5 20V9l7-5 7 5v11" />
            <path d="M9 20v-5h6v5" />
          </svg>
        </span>
        <span className={styles.brandText}>
          <strong>工事みえるマップ 3D Beta</strong>
          <em>Construction Public Twin Portal</em>
        </span>
      </div>

      <ProjectSearch />

      <ProjectFilter />

      <div className={styles.topbarRight}>
        {updated && (
          <span className={styles.updated}>
            <span className={styles.dot} aria-hidden="true" />
            <span>
              情報更新 <span className="num">{formatUpdated(updated)}</span>
            </span>
          </span>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={() => setHelpOpen(true)}
          aria-label="使い方と情報源について"
          title="使い方と情報源について"
        >
          ?
        </button>
      </div>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </header>
  );
}
