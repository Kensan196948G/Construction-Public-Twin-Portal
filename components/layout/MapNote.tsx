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
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ビューポート上部中央の状況注記。 */
export function MapNote() {
  const viewTime = useAppStore((s) => s.viewTime);
  const viewMode = useAppStore((s) => s.viewMode);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const searchKeyword = useAppStore((s) => s.searchKeyword);
  const selectedCategory = useAppStore((s) => s.selectedCategory);
  const selectedStatus = useAppStore((s) => s.selectedStatus);
  const regulatingOnly = useAppStore((s) => s.regulatingOnly);

  const all = useMemo(() => publicProjects(), []);
  const viewDate = useMemo(() => new Date(viewTime), [viewTime]);

  const visibleCount = useMemo(
    () =>
      filterProjects(all, {
        keyword: searchKeyword,
        category: selectedCategory,
        status: selectedStatus,
        regulatingOnly,
        viewTime: viewDate,
      }).length,
    [all, searchKeyword, selectedCategory, selectedStatus, regulatingOnly, viewDate],
  );

  const selected = useMemo(
    () => all.find((p) => p.id === selectedProjectId) ?? null,
    [all, selectedProjectId],
  );

  const activeRegulations = useMemo(
    () => impactsActiveAt(viewDate).filter((i) => i.severity !== "info").length,
    [viewDate],
  );

  return (
    <div className={`float ${styles.mapNote}`} role="status" aria-live="polite">
      <b>{formatDate(viewTime)}</b> 時点 / {viewMode === "3d" ? "3D" : "2D"}表示 ・ 工事{" "}
      <b>{visibleCount}</b> 件 ・ 有効な規制 <b>{activeRegulations}</b> 件
      {selected ? (
        <>
          {" "}
          ・ 選択中: <b>{selected.publicTitle}</b>
        </>
      ) : null}
    </div>
  );
}
