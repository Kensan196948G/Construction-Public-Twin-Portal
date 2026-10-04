"use client";

/**
 * 車線規制・通行止め／歩道切替レイヤー。
 *
 * 案件の ProjectGeometry（regulation / pedestrian）を線として描画する。
 * どの Impact を代表にするか、時間軸でどう薄くするかは impactGeometry.ts が決める。
 * クリックで selectImpact() を呼ぶ。
 */
import { Line } from "@react-three/drei";
import { useMemo } from "react";

import type { ProjectRecord } from "@/lib/data/projects";
import type { Impact } from "@/lib/schemas/impact";
import {
  projectSceneCenter,
  toLinePoints,
  type Vec2,
} from "@/lib/viewer/sceneBuilder";

import {
  IMPACT_LINE_Y,
  impactLineStyle,
  impactOpacity,
  impactTemporalState,
  pickRepresentative,
  type ImpactGeometryKindName,
} from "./impactGeometry";
import { LocalSceneTransform } from "./LocalSceneTransform";

/** 本レイヤーが扱う種別（迂回路は DetourLayer が担当する） */
type SurfaceKind = Exclude<ImpactGeometryKindName, "detour">;

/** 歩道切替・規制は「線分」なので閉じない */
function ringOf(record: ProjectRecord, kind: SurfaceKind): Vec2[] | null {
  const points = kind === "regulation" ? record.geometry.regulation : record.geometry.pedestrian;
  if (!points || points.length < 2) return null;
  return points.map(([x, z]) => ({ x, z }));
}

interface ImpactLineProps {
  record: ProjectRecord;
  kind: SurfaceKind;
  impacts: readonly Impact[];
  viewTime: Date;
  selectedImpactId: string | null;
  onSelectImpact: (impactId: string) => void;
}

function ImpactLine({
  record,
  kind,
  impacts,
  viewTime,
  selectedImpactId,
  onSelectImpact,
}: ImpactLineProps) {
  const center = useMemo(() => projectSceneCenter(record.project), [record.project]);
  const representative = useMemo(() => pickRepresentative(impacts, viewTime), [impacts, viewTime]);

  const points = useMemo(() => {
    const ring = ringOf(record, kind);
    return ring ? toLinePoints(ring, IMPACT_LINE_Y) : null;
  }, [kind, record]);

  if (!points || !representative) return null;

  const style = impactLineStyle(kind);
  const selected = representative.id === selectedImpactId;
  const state = impactTemporalState(representative, viewTime);
  const opacity = impactOpacity(state, selected);

  return (
    <LocalSceneTransform center={center}>
      <Line
        points={points}
        color={style.color}
        lineWidth={selected ? style.lineWidth + 2 : style.lineWidth}
        transparent
        opacity={opacity}
        onClick={(event) => {
          event.stopPropagation();
          onSelectImpact(representative.id);
        }}
      />
    </LocalSceneTransform>
  );
}

export interface ImpactLayerProps {
  records: readonly ProjectRecord[];
  impacts: readonly Impact[];
  viewTime: Date;
  selectedImpactId: string | null;
  /** 車線規制・通行止めレイヤーの表示 */
  regulationVisible: boolean;
  /** 歩道切替レイヤーの表示 */
  pedestrianVisible: boolean;
  onSelectImpact: (impactId: string) => void;
}

export function ImpactLayer({
  records,
  impacts,
  viewTime,
  selectedImpactId,
  regulationVisible,
  pedestrianVisible,
  onSelectImpact,
}: ImpactLayerProps) {
  const kinds = useMemo<SurfaceKind[]>(() => {
    const list: SurfaceKind[] = [];
    if (regulationVisible) list.push("regulation");
    if (pedestrianVisible) list.push("pedestrian");
    return list;
  }, [regulationVisible, pedestrianVisible]);

  const impactsByProject = useMemo(() => {
    const map = new Map<string, Impact[]>();
    for (const impact of impacts) {
      if (impact.geometryKind !== "regulation" && impact.geometryKind !== "pedestrian") continue;
      const list = map.get(impact.projectId);
      if (list) list.push(impact);
      else map.set(impact.projectId, [impact]);
    }
    return map;
  }, [impacts]);

  if (kinds.length === 0) return null;

  return (
    <group>
      {records.map((record) => {
        const list = impactsByProject.get(record.project.id);
        if (!list || list.length === 0) return null;
        return (
          <group key={record.project.id}>
            {kinds.map((kind) => (
              <ImpactLine
                key={kind}
                record={record}
                kind={kind}
                impacts={list.filter((impact) => impact.geometryKind === kind)}
                viewTime={viewTime}
                selectedImpactId={selectedImpactId}
                onSelectImpact={onSelectImpact}
              />
            ))}
          </group>
        );
      })}
    </group>
  );
}
