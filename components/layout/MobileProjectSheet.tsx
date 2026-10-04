"use client";

import { ProjectDetailCard } from "@/components/project/ProjectDetailCard";
import { useAppStore } from "@/lib/store/useAppStore";
import styles from "./layout.module.css";

/**
 * 640px 以下で詳細カードをボトムシートとして表示する。
 * トリガーボタン（ビューポート右上の「詳細」）は ViewportControls が持つ。
 */
export function MobileProjectSheet() {
  const open = useAppStore((s) => s.mobileSheetOpen);
  const setOpen = useAppStore((s) => s.setMobileSheetOpen);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);

  return (
    <>
      {open && (
        <div
          className={styles.sheetBackdrop}
          role="presentation"
          onClick={() => setOpen(false)}
        />
      )}
      {open && (
        <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="工事の詳細">
          <div className={styles.sheetHead}>
            <h2>工事の詳細</h2>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setOpen(false)}
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>
          <div className={styles.sheetBody}>
            {selectedProjectId ? (
              <ProjectDetailCard projectId={selectedProjectId} />
            ) : (
              <div className={styles.emptyDetail}>
                <p>一覧または地図から工事を選んでください。</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
