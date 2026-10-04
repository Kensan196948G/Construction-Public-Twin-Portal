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
  const viewerEngine = useAppStore((s) => s.viewerEngine);
  const setViewerEngine = useAppStore((s) => s.setViewerEngine);
  const base3dSource = useAppStore((s) => s.base3dSource);
  const setBase3dSource = useAppStore((s) => s.setBase3dSource);
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
          {/*
            3D エンジン。既定は CesiumJS（日本3Dビル + 公的タイル + 施工範囲）。
            初期化に失敗した場合はビューア自身が「内蔵3D」へ自動フォールバックする。
          */}
          <span className={styles.controlLabel}>3Dエンジン</span>
          <div className="seg" role="group" aria-label="3Dエンジンの切り替え">
            <button
              type="button"
              className={viewerEngine === "cesium" ? "active" : ""}
              aria-pressed={viewerEngine === "cesium"}
              onClick={() => setViewerEngine("cesium")}
              title="CesiumJS。地理院タイル・PLATEAU地形・3D建物・施工範囲を地球座標で表示"
            >
              日本3Dビル
            </button>
            <button
              type="button"
              className={viewerEngine === "three" ? "active" : ""}
              aria-pressed={viewerEngine === "three"}
              onClick={() => setViewerEngine("three")}
              title="外部配信に依存しない内蔵のThree.jsビューア（現場ごとの3D）"
            >
              内蔵3D
            </button>
          </div>

          {/*
            表示スコープ（現場 / 地区全体）の切替は 3D ビューア側のバーが持つ。
            スコープ変更時はカメラプリセットの再適用が必要なため、
            ビューア内部（components/viewer/PublicTwinViewer.tsx）に一元化している。
            ここに重複して置かないこと。
          */}
          {viewerEngine === "three" && (
            <>
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
