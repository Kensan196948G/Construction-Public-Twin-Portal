"use client";

import { ProjectList } from "@/components/map/ProjectList";
import { LayerControl } from "@/components/viewer/LayerControl";
import { filterProjects } from "@/lib/data/filter";
import { publicProjects } from "@/lib/data/projects";
import { useAppStore } from "@/lib/store/useAppStore";
import styles from "./layout.module.css";

/**
 * ビューポート左上のフローティングパネル。
 * 「工事一覧」と「レイヤー」をタブで切り替える。
 */
export function Sidebar() {
  const sidebarTab = useAppStore((s) => s.sidebarTab);
  const setSidebarTab = useAppStore((s) => s.setSidebarTab);
  const searchKeyword = useAppStore((s) => s.searchKeyword);
  const selectedCategory = useAppStore((s) => s.selectedCategory);
  const selectedStatus = useAppStore((s) => s.selectedStatus);
  const regulatingOnly = useAppStore((s) => s.regulatingOnly);
  const viewTime = useAppStore((s) => s.viewTime);

  const count = filterProjects(publicProjects(), {
    keyword: searchKeyword,
    category: selectedCategory,
    status: selectedStatus,
    regulatingOnly,
    viewTime: new Date(viewTime),
  }).length;

  return (
    <section className={`float ${styles.sidebar}`} aria-label="工事一覧とレイヤー">
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={sidebarTab === "projects"}
          className={`${styles.tab} ${sidebarTab === "projects" ? styles.tabActive : ""}`}
          onClick={() => setSidebarTab("projects")}
        >
          工事一覧
          <span className={styles.tabCount}>{count}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sidebarTab === "layers"}
          className={`${styles.tab} ${sidebarTab === "layers" ? styles.tabActive : ""}`}
          onClick={() => setSidebarTab("layers")}
        >
          レイヤー
        </button>
      </div>

      <div className={styles.tabBody}>
        {sidebarTab === "projects" ? <ProjectList /> : <LayerControl />}
      </div>
    </section>
  );
}
