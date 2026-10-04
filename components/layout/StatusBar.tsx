"use client";

import { useMemo } from "react";

import { filterProjects } from "@/lib/data/filter";
import { impactsActiveAt } from "@/lib/data/impacts";
import { publicProjects } from "@/lib/data/projects";
import { useAppStore } from "@/lib/store/useAppStore";
import styles from "./layout.module.css";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`;
}

export function StatusBar() {
  const searchKeyword = useAppStore((s) => s.searchKeyword);
  const selectedCategory = useAppStore((s) => s.selectedCategory);
  const selectedStatus = useAppStore((s) => s.selectedStatus);
  const regulatingOnly = useAppStore((s) => s.regulatingOnly);
  const viewTime = useAppStore((s) => s.viewTime);
  const viewMode = useAppStore((s) => s.viewMode);
  const completionMode = useAppStore((s) => s.completionMode);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);

  const all = useMemo(() => publicProjects(), []);
  const viewDate = useMemo(() => new Date(viewTime), [viewTime]);

  const visible = useMemo(
    () =>
      filterProjects(all, {
        keyword: searchKeyword,
        category: selectedCategory,
        status: selectedStatus,
        regulatingOnly,
        viewTime: viewDate,
      }),
    [all, searchKeyword, selectedCategory, selectedStatus, regulatingOnly, viewDate],
  );

  const activeImpacts = useMemo(() => impactsActiveAt(viewDate), [viewDate]);
  const selected = useMemo(
    () => all.find((p) => p.id === selectedProjectId) ?? null,
    [all, selectedProjectId],
  );

  const completionLabel =
    completionMode === "current" ? "現在" : completionMode === "planned" ? "完成予想" : "比較";

  return (
    <footer className={styles.statusbar}>
      <span>
        表示中 <b className="num">{visible.length}</b> 件 / 全 <b className="num">{all.length}</b> 件
      </span>
      <span className={styles.sep} aria-hidden="true" />
      <span className={styles.hideSm}>
        基準日 <b className="num">{formatDate(viewTime)}</b>
      </span>
      <span className={styles.sep} aria-hidden="true" />
      <span>
        有効な規制等 <b className="num">{activeImpacts.length}</b> 件
      </span>
      <span className={styles.sep} aria-hidden="true" />
      <span className={styles.hideSm}>
        表示 <b>{viewMode === "3d" ? "3D" : "2D"}</b> / 完成像 <b>{completionLabel}</b>
      </span>

      {selected && (
        <>
          <span className={styles.sep} aria-hidden="true" />
          <span className={styles.hideSm}>
            選択中 <b>{selected.publicTitle}</b>
          </span>
        </>
      )}

      <span className={styles.spacer} />
      <span className={styles.sbTag}>開発用サンプルデータ / 写真: Wikimedia Commons</span>
    </footer>
  );
}
