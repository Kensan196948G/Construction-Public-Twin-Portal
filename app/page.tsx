"use client";

import dynamic from "next/dynamic";

import { Legend } from "@/components/layout/Legend";
import { MapNote } from "@/components/layout/MapNote";
import { MobileProjectSheet } from "@/components/layout/MobileProjectSheet";
import { Sidebar } from "@/components/layout/Sidebar";
import { StatusBar } from "@/components/layout/StatusBar";
import { Toast } from "@/components/layout/Toast";
import { TopBar } from "@/components/layout/TopBar";
import { ViewportControls } from "@/components/layout/ViewportControls";
import layout from "@/components/layout/layout.module.css";
import { GeoContextPanel } from "@/components/map/GeoContextPanel";
import { ProjectDetailCard } from "@/components/project/ProjectDetailCard";
import { SiteViewer } from "@/components/project/SiteViewer";
import { TimelineControl } from "@/components/viewer/TimelineControl";
import { useAppStore } from "@/lib/store/useAppStore";

/**
 * 3D / 2D ビューアはブラウザ専用 API（WebGL / Canvas / ResizeObserver）を使うため、
 * SSR を無効化して遅延読み込みする。読み込み中はスピナーを表示する。
 */
function ViewerFallback({ label }: { label: string }) {
  return (
    <div className="spinner">
      <span className="ring" aria-hidden="true" />
      <span className="num" style={{ fontSize: 12, color: "var(--muted)" }}>
        {label}を読み込んでいます…
      </span>
    </div>
  );
}

const PublicTwinViewer = dynamic(
  () => import("@/components/viewer/PublicTwinViewer").then((m) => m.PublicTwinViewer),
  { ssr: false, loading: () => <ViewerFallback label="3Dビューア" /> },
);

/**
 * 主題の3Dビューア（CesiumJS + 日本3Dビル + 公的タイル + 施工範囲）。
 * 初期化に失敗した場合はビューア自身が `viewerEngine` を "three" へ戻し、
 * 内蔵の Three.js ビューアへ自動フォールバックする。
 */
const CesiumJapanViewer = dynamic(
  () => import("@/components/viewer/CesiumJapanViewer").then((m) => m.CesiumJapanViewer),
  { ssr: false, loading: () => <ViewerFallback label="3D都市ビュー（CesiumJS）" /> },
);

const FallbackMap = dynamic(
  () => import("@/components/map/FallbackMap").then((m) => m.FallbackMap),
  { ssr: false, loading: () => <ViewerFallback label="2D地図" /> },
);

function EmptyDetail() {
  return (
    <div className={layout.emptyDetail}>
      <h2>工事を選んでください</h2>
      <p>
        地図上の工事位置をクリックするか、左の「工事一覧」から案件を選ぶと、
        工事目的・工期・交通規制・完成予想・出典がここに表示されます。
      </p>
      <ol className={layout.emptySteps}>
        <li>
          <span className="n">1</span>
          <span>上部の検索で工事件名・自治体・住所・工種を絞り込む</span>
        </li>
        <li>
          <span className="n">2</span>
          <span>一覧または地図から工事を選ぶ</span>
        </li>
        <li>
          <span className="n">3</span>
          <span>下部の時間軸で基準日を動かし、その日の規制を確認する</span>
        </li>
        <li>
          <span className="n">4</span>
          <span>必要に応じて 2D / 3D を切り替える</span>
        </li>
      </ol>
    </div>
  );
}

export default function Page() {
  const viewMode = useAppStore((s) => s.viewMode);
  const viewerEngine = useAppStore((s) => s.viewerEngine);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);

  return (
    <div className={layout.app}>
      <TopBar />

      <div className={layout.workspace}>
        <div className={layout.viewport}>
          {viewMode === "2d" ? (
            <FallbackMap />
          ) : viewerEngine === "cesium" ? (
            <CesiumJapanViewer />
          ) : (
            <PublicTwinViewer />
          )}

          <MapNote />
          <Sidebar />
          <ViewportControls />
          <Legend />
          <TimelineControl />
          <GeoContextPanel />
        </div>

        <aside className={layout.detailPane} aria-label="工事の詳細">
          {selectedProjectId ? (
            <ProjectDetailCard projectId={selectedProjectId} />
          ) : (
            <EmptyDetail />
          )}
        </aside>
      </div>

      <StatusBar />

      <MobileProjectSheet />
      <SiteViewer />
      <Toast />
    </div>
  );
}
