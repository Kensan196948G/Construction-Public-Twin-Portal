"use client";

/**
 * 現場3Dの GIS レイヤー（`DATA_LAYERS` の `gis`）。
 *
 * 既存の 工区 / 車線規制 / 迂回路 / 歩道切替 を **まとめて** 制御する。
 * GIS が OFF のときは4つとも消える（`lib/store` の契約）。
 *
 * 座標は案件中心を原点とするローカル座標（`ProjectGeometry` の生値）を
 * そのまま使う。現場3Dはシーン原点 = 案件中心だからである。
 */
import { Line } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

import type { ProjectRecord } from "@/lib/data/projects";
import type { Impact } from "@/lib/schemas/impact";
import { closeRing, toLinePoints, type Vec2 } from "@/lib/viewer/sceneBuilder";
import { SITE_LAYER_Y } from "@/lib/viewer/siteScene";

import {
  IMPACT_LINE_Y,
  impactLineStyle,
  impactOpacity,
  impactTemporalState,
  pickRepresentative,
  type ImpactGeometryKindName,
} from "./impactGeometry";

/** 工区外周線の高さ */
const OUTLINE_Y = SITE_LAYER_Y.zone + 0.14;
/** 工区塗りの高さ */
const ZONE_Y = SITE_LAYER_Y.zone;

export interface SiteGisLayerProps {
  record: ProjectRecord;
  /** この案件に紐づく影響イベント（全種別） */
  impacts: readonly Impact[];
  viewTime: Date;
  selectedImpactId: string | null;
  /** 工区の色（表示日時の施工状態） */
  zoneColor: number;
  workzone: boolean;
  regulation: boolean;
  detour: boolean;
  pedestrian: boolean;
  onSelectImpact?: (impactId: string) => void;
}

function ImpactPath({
  kind,
  path,
  impacts,
  viewTime,
  selectedImpactId,
  onSelectImpact,
}: {
  kind: ImpactGeometryKindName;
  path: [number, number][] | null;
  impacts: readonly Impact[];
  viewTime: Date;
  selectedImpactId: string | null;
  onSelectImpact?: (impactId: string) => void;
}) {
  const points = useMemo(() => {
    if (!path || path.length < 2) return null;
    return toLinePoints(
      path.map(([x, z]) => ({ x, z }) as Vec2),
      IMPACT_LINE_Y,
    );
  }, [path]);

  const representative = useMemo(
    () => pickRepresentative(impacts.filter((i) => i.geometryKind === kind), viewTime),
    [impacts, kind, viewTime],
  );

  if (!points || !representative) return null;

  const style = impactLineStyle(kind);
  const selected = representative.id === selectedImpactId;
  const opacity = impactOpacity(impactTemporalState(representative, viewTime), selected);

  return (
    <Line
      points={points}
      color={style.color}
      lineWidth={selected ? style.lineWidth + 2 : style.lineWidth}
      dashed={style.dashed}
      dashSize={style.dashSize}
      gapSize={style.gapSize}
      transparent
      opacity={opacity}
      onClick={
        onSelectImpact
          ? (event) => {
              event.stopPropagation();
              onSelectImpact(representative.id);
            }
          : undefined
      }
    />
  );
}

export function SiteGisLayer({
  record,
  impacts,
  viewTime,
  selectedImpactId,
  zoneColor,
  workzone,
  regulation,
  detour,
  pedestrian,
  onSelectImpact,
}: SiteGisLayerProps) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    record.geometry.zone.forEach(([x, z], index) => {
      if (index === 0) s.moveTo(x, z);
      else s.lineTo(x, z);
    });
    s.closePath();
    return s;
  }, [record.geometry.zone]);

  const outline = useMemo(
    () => toLinePoints(closeRing(record.geometry.zone.map(([x, z]) => ({ x, z }))), OUTLINE_Y),
    [record.geometry.zone],
  );

  return (
    <group>
      {workzone ? (
        <group>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ZONE_Y, 0]}>
            <shapeGeometry args={[shape]} />
            <meshBasicMaterial
              color={zoneColor}
              transparent
              opacity={0.34}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <Line points={outline} color={zoneColor} lineWidth={3} transparent opacity={0.95} />
        </group>
      ) : null}

      {regulation ? (
        <ImpactPath
          kind="regulation"
          path={record.geometry.regulation}
          impacts={impacts}
          viewTime={viewTime}
          selectedImpactId={selectedImpactId}
          onSelectImpact={onSelectImpact}
        />
      ) : null}

      {detour ? (
        <ImpactPath
          kind="detour"
          path={record.geometry.detour}
          impacts={impacts}
          viewTime={viewTime}
          selectedImpactId={selectedImpactId}
          onSelectImpact={onSelectImpact}
        />
      ) : null}

      {pedestrian ? (
        <ImpactPath
          kind="pedestrian"
          path={record.geometry.pedestrian}
          impacts={impacts}
          viewTime={viewTime}
          selectedImpactId={selectedImpactId}
          onSelectImpact={onSelectImpact}
        />
      ) : null}
    </group>
  );
}
