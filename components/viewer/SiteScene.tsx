"use client";

/**
 * 現場ごとの3Dシーン（**`<Canvas>` を含まない「シーンの中身」**）。
 *
 *   呼び出し側:
 *     <Canvas camera={...}><SiteScene projectId={id} /></Canvas>
 *
 * ## 責務（凍結）
 * 含める: ライト / フォグ・背景色（thumbnail では省略）/ 地面・周辺の街並み /
 *         現場モデル（完成予想）/ 工区・規制・迂回路・歩道切替（GIS）/
 *         `dataLayers` に応じた全データレイヤー
 * 含めない: `<Canvas>` / カメラ操作（OrbitControls 等）/ カメラ初期位置 / DOM UI
 *
 * 理由: `Site3DGallery` は24現場を順に描画して画像化するため、操作系があると
 * 撮影が不安定になる。カメラの既定値は `lib/viewer/cameraPresets.ts` の
 * `siteCameraFor()` を使う。
 *
 * 座標系: **案件中心を原点**とする（x = 東, y = 高さ, z = 南）。
 * すべて手続き生成のため、外部ネットワークが無くても描画できる。
 * 形状は実データではなくサンプル（合成）データである（`lib/site/sceneData.ts`）。
 */
import { useMemo } from "react";

import { impactsForProject } from "@/lib/data/impacts";
import { getProjectRecordById } from "@/lib/data/projects";
import { buildSiteModelData } from "@/lib/site/sceneData";
import { useAppStore, type CompletionMode } from "@/lib/store/useAppStore";
import { SCENE_COLORS, projectStatusAt, statusColor } from "@/lib/viewer/sceneBuilder";
import { SITE_COLORS, buildSiteContext, siteRadius } from "@/lib/viewer/siteScene";

import { CompletionModel } from "./CompletionModel";
import { SiteDataLayers, type SiteVariant } from "./SiteDataLayers";
import { SiteGisLayer } from "./SiteGisLayer";

export interface SiteSceneProps {
  projectId: string;
  /** "full" = 通常表示 / "thumbnail" = ギャラリー用の軽量表示（負荷を下げる） */
  variant?: SiteVariant;
}

/** 工事位置マーカー（現場の基準点） */
function SiteMarker({ color, radius }: { color: number; radius: number }) {
  const poleHeight = Math.max(6, Math.min(radius * 0.9, 20));
  return (
    <group>
      <mesh position={[0, poleHeight / 2, 0]}>
        <cylinderGeometry args={[0.3, 0.3, poleHeight, 8]} />
        <meshLambertMaterial color={SCENE_COLORS.markerPole} />
      </mesh>
      <mesh position={[0, poleHeight + 2.4, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[2.6, 4.8, 14]} />
        <meshLambertMaterial color={color} />
      </mesh>
    </group>
  );
}

export function SiteScene({ projectId, variant = "full" }: SiteSceneProps): React.ReactElement | null {
  const record = useMemo(() => getProjectRecordById(projectId), [projectId]);
  const dataLayers = useAppStore((s) => s.dataLayers);
  const visibleLayers = useAppStore((s) => s.visibleLayers);
  const completionMode = useAppStore((s) => s.completionMode);
  const viewTime = useAppStore((s) => s.viewTime);
  const selectedImpactId = useAppStore((s) => s.selectedImpactId);
  const selectImpact = useAppStore((s) => s.selectImpact);

  const data = useMemo(
    () => (record ? buildSiteModelData(record.project) : null),
    [record],
  );
  const impacts = useMemo(
    () => (record ? impactsForProject(record.project.id) : []),
    [record],
  );

  const isThumb = variant === "thumbnail";
  const context = useMemo(
    () => (data ? buildSiteContext(data, isThumb ? 9 : 14) : null),
    [data, isThumb],
  );
  const viewDate = useMemo(() => new Date(viewTime), [viewTime]);

  if (!record || !data || !context) return null;

  const radius = siteRadius(data);
  const groundSize = radius * 9;
  const zoneColor = statusColor(projectStatusAt(record.project, viewDate));

  /**
   * 完成予想の表示モード。
   * サムネイルは既定（current）でも半透明で重ね、その現場の形が分かるようにする。
   */
  const completionTarget: Exclude<CompletionMode, "current"> | null = !visibleLayers.completion
    ? null
    : completionMode === "current"
      ? isThumb
        ? "compare"
        : null
      : completionMode;

  return (
    <>
      {/* 背景とフォグ（サムネイルでは切って負荷を下げる）。fragment 直下なので
          attach は Canvas のシーンへ効く。 */}
      {isThumb ? null : (
        <>
          <color attach="background" args={[SCENE_COLORS.sky]} />
          <fog attach="fog" args={[SCENE_COLORS.fog, radius * 7, radius * 26]} />
        </>
      )}

      <hemisphereLight args={[0xf2f5f9, 0x9aa0a8, 0.95]} />
      <directionalLight position={[-radius * 2, radius * 3.2, radius * 1.8]} intensity={0.75} />
      <directionalLight position={[radius * 2, radius * 1.6, -radius * 2]} intensity={0.28} />

      {/* 地面と周辺の街並み（文脈。他案件のモデル・工区は描かない） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[groundSize, groundSize]} />
        <meshLambertMaterial color={SITE_COLORS.ground} />
      </mesh>

      {context.roads.map((road) => (
        <mesh
          key={road.id}
          rotation={[-Math.PI / 2, 0, road.axis === "x" ? 0 : Math.PI / 2]}
          position={[road.axis === "x" ? 0 : road.offset, 0.04, road.axis === "x" ? road.offset : 0]}
        >
          <planeGeometry args={[road.length, road.width]} />
          <meshLambertMaterial color={SITE_COLORS.road} />
        </mesh>
      ))}

      {context.buildings.map((building) => (
        <mesh key={building.id} position={[building.x, building.h / 2, building.z]}>
          <boxGeometry args={[building.w, building.h, building.d]} />
          <meshLambertMaterial color={building.alt ? SITE_COLORS.contextAlt : SITE_COLORS.context} />
        </mesh>
      ))}

      {/* 工事位置マーカー */}
      {visibleLayers.markers ? <SiteMarker color={zoneColor} radius={radius} /> : null}

      {/* 完成予想モデル（現在 / 完成予想 / 比較） */}
      {completionTarget ? (
        <CompletionModel
          type={record.project.visual.completionType}
          dims={{
            widthM: record.project.visual.siteWidthM,
            depthM: record.project.visual.siteDepthM,
            floors: record.project.visual.floors,
          }}
          mode={completionTarget}
          selected
        />
      ) : null}

      {/* GIS（工区・規制・迂回路・歩道切替）— dataLayers.gis が全てを制御する */}
      <SiteGisLayer
        record={record}
        impacts={impacts}
        viewTime={viewDate}
        selectedImpactId={selectedImpactId}
        zoneColor={zoneColor}
        workzone={dataLayers.gis && visibleLayers.workzone}
        regulation={dataLayers.gis && visibleLayers.regulation}
        detour={dataLayers.gis && visibleLayers.detour}
        pedestrian={dataLayers.gis && visibleLayers.pedestrian}
        onSelectImpact={selectImpact}
      />

      {/* データレイヤー（BIM / CAD / 点群 / 3DGS / スマホ / 写真 / 進捗 / 点検 / 軌跡 / AIピン） */}
      <SiteDataLayers data={data} variant={variant} layers={dataLayers} />
    </>
  );
}
