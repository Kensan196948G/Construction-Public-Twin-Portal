"use client";

import { useAppStore } from "@/lib/store/useAppStore";
import styles from "./layout.module.css";

/**
 * ビューポート右上の表示切替。
 * 3D のカメラプリセットは 3D ビューア側（components/viewer）が担当する。
 */
export function ViewportControls() {
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const base3dSource = useAppStore((s) => s.base3dSource);
  const setBase3dSource = useAppStore((s) => s.setBase3dSource);
  const viewScope = useAppStore((s) => s.viewScope);
  const setViewScope = useAppStore((s) => s.setViewScope);
  const openSiteViewer = useAppStore((s) => s.openSiteViewer);
  const setMobileSheetOpen = useAppStore((s) => s.setMobileSheetOpen);

  return (
    <div className={`float ${styles.viewControls}`} aria-label="表示の切り替え">
      <span className={styles.controlLabel}>表示</span>
      <div className="seg" role="group" aria-label="2D / 3D の切り替え">
        <button
          type="button"
          className={viewMode === "3d" ? "active" : ""}
          aria-pressed={viewMode === "3d"}
          onClick={() => setViewMode("3d")}
        >
          3D
        </button>
        <button
          type="button"
          className={viewMode === "2d" ? "active" : ""}
          aria-pressed={viewMode === "2d"}
          onClick={() => setViewMode("2d")}
        >
          2D
        </button>
      </div>

      {viewMode === "3d" && (
        <>
          <span className={styles.controlLabel}>3Dの範囲</span>
          <div className="seg" role="group" aria-label="3D表示の範囲">
            <button
              type="button"
              className={viewScope === "site" ? "active" : ""}
              aria-pressed={viewScope === "site"}
              onClick={() => setViewScope("site")}
              title="選択した1現場だけを3D表示します"
            >
              現場
            </button>
            <button
              type="button"
              className={viewScope === "area" ? "active" : ""}
              aria-pressed={viewScope === "area"}
              onClick={() => setViewScope("area")}
              title="地区全体の工区を俯瞰します"
            >
              地区
            </button>
          </div>

          <span className={styles.controlLabel}>3D背景</span>
          <div className="seg" role="group" aria-label="3D背景の切り替え">
            <button
              type="button"
              className={base3dSource === "local" ? "active" : ""}
              aria-pressed={base3dSource === "local"}
              onClick={() => setBase3dSource("local")}
              title="外部配信に依存しない簡易3D都市モデル"
            >
              内蔵
            </button>
            <button
              type="button"
              className={base3dSource === "plateau" ? "active" : ""}
              aria-pressed={base3dSource === "plateau"}
              onClick={() => setBase3dSource("plateau")}
              title="PLATEAU 3D Tiles（未構成の場合は内蔵背景へ自動切替）"
            >
              PLATEAU
            </button>
          </div>
        </>
      )}

      <span className={styles.controlLabel}>操作</span>
      <div className={styles.camRow}>
        <button
          type="button"
          className="chip-btn"
          onClick={() => openSiteViewer()}
          title="24現場の3Dギャラリーと現場写真を開きます"
        >
          現場ギャラリー
        </button>
        <button
          type="button"
          className={`chip-btn ${styles.mobileOnly}`}
          onClick={() => setMobileSheetOpen(true)}
        >
          詳細
        </button>
      </div>
    </div>
  );
}
