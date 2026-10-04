"use client";

/**
 * 迂回路レイヤー。
 *
 * 案件の ProjectGeometry.detour を破線で描画する。
 * 時間軸に対して有効な迂回路は濃く、期間外は薄く残す（impactGeometry.ts が判定）。
 */
import { Line } from "@react-three/drei";
import { useMemo } from "react";

import type { ProjectRecord } from "@/lib/data/projects";
import type { Impact } from "@/lib/schemas/impact";
import { projectSceneCenter, toLinePoints, type Vec2 } from "@/lib/viewer/sceneBuilder";

import {
  IMPACT_LINE_Y,
  impactLineStyle,
  impactOpacity,
  impactTemporalState,
  pickRepresentative,
} from "./impactGeometry";
import { LocalSceneTransform } from "./LocalSceneTransform";

interface DetourLineProps {
  record: ProjectRecord;
  impacts: readonly Impact[];
  viewTime: Date;
  selectedImpactId: string | null;
  onSelectImpact: (impactId: string) => void;
}

function DetourLine({
  record,
  impacts,
  viewTime,
  selectedImpactId,
  onSelectImpact,
}: DetourLineProps) {
  const center = useMemo(() => projectSceneCenter(record.project), [record.project]);
  const representative = useMemo(() => pickRepresentative(impacts, viewTime), [impacts, viewTime]);

  const points = useMemo(() => {
    const ring = record.geometry.detour;
    if (!ring || ring.length < 2) return null;
    const path: Vec2[] = ring.map(([x, z]) => ({ x, z }));
    return toLinePoints(path, IMPACT_LINE_Y);
  }, [record.geometry.detour]);

  if (!points || !representative) return null;

  const style = impactLineStyle("detour");
  const selected = representative.id === selectedImpactId;
  const state = impactTemporalState(representative, viewTime);
  const opacity = impactOpacity(state, selected);

  return (
    <LocalSceneTransform center={center}>
      <Line
        points={points}
        color={style.color}
        lineWidth={selected ? style.lineWidth + 2 : style.lineWidth}
        dashed
        dashSize={style.dashSize}
        gapSize={style.gapSize}
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

export interface DetourLayerProps {
  records: readonly ProjectRecord[];
  impacts: readonly Impact[];
  viewTime: Date;
  selectedImpactId: string | null;
  visible: boolean;
  onSelectImpact: (impactId: string) => void;
}

export function DetourLayer({
  records,
  impacts,
  viewTime,
  selectedImpactId,
  visible,
  onSelectImpact,
}: DetourLayerProps) {
  const impactsByProject = useMemo(() => {
    const map = new Map<string, Impact[]>();
    for (const impact of impacts) {
      if (impact.geometryKind !== "detour") continue;
      const list = map.get(impact.projectId);
      if (list) list.push(impact);
      else map.set(impact.projectId, [impact]);
    }
    return map;
  }, [impacts]);

  if (!visible) return null;

  return (
    <group>
      {records.map((record) => {
        const list = impactsByProject.get(record.project.id);
        if (!list || list.length === 0) return null;
        return (
          <DetourLine
            key={record.project.id}
            record={record}
            impacts={list}
            viewTime={viewTime}
            selectedImpactId={selectedImpactId}
            onSelectImpact={onSelectImpact}
          />
        );
      })}
    </group>
  );
}
