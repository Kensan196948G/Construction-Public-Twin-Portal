"use client";

/**
 * 工事位置マーカーと完成予想モデルの重ね合わせ。
 *
 * - マーカー: 案件の基準点に立てるピン（色 = 表示日時の施工状態）。クリックで選択。
 * - 完成予想: CompletionModel を completionMode に従って表示する。
 *   current のときは何も描かない。選択が無いときは全案件を対象にする。
 */
import { useMemo } from "react";

import type { ProjectRecord } from "@/lib/data/projects";
import type { CompletionMode } from "@/lib/store/useAppStore";
import {
  SCENE_COLORS,
  projectSceneCenter,
  projectStatusAt,
  statusColor,
} from "@/lib/viewer/sceneBuilder";

import { CompletionModel } from "./CompletionModel";
import { LocalSceneTransform } from "./LocalSceneTransform";

const POLE_HEIGHT_M = 26;
const MARKER_HEAD_Y = 32;

interface ProjectMarkerProps {
  record: ProjectRecord;
  color: number;
  selected: boolean;
  onSelect: (projectId: string) => void;
}

function ProjectMarker({ record, color, selected, onSelect }: ProjectMarkerProps) {
  const center = useMemo(() => projectSceneCenter(record.project), [record.project]);

  return (
    <LocalSceneTransform center={center}>
      <group
        onClick={(event) => {
          event.stopPropagation();
          onSelect(record.project.id);
        }}
      >
        <mesh position={[0, POLE_HEIGHT_M / 2, 0]}>
          <cylinderGeometry args={[1, 1, POLE_HEIGHT_M, 8]} />
          <meshLambertMaterial color={SCENE_COLORS.markerPole} />
        </mesh>
        <mesh position={[0, MARKER_HEAD_Y, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[selected ? 8.5 : 7, 12, 12]} />
          <meshLambertMaterial color={color} />
        </mesh>
      </group>
    </LocalSceneTransform>
  );
}

export interface ProjectOverlayProps {
  records: readonly ProjectRecord[];
  viewTime: Date;
  markersVisible: boolean;
  completionVisible: boolean;
  completionMode: CompletionMode;
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
}

export function ProjectOverlay({
  records,
  viewTime,
  markersVisible,
  completionVisible,
  completionMode,
  selectedProjectId,
  onSelect,
}: ProjectOverlayProps) {
  const completionTargets = useMemo(
    () =>
      selectedProjectId
        ? records.filter((record) => record.project.id === selectedProjectId)
        : records,
    [records, selectedProjectId],
  );

  const showCompletion = completionVisible && completionMode !== "current";

  return (
    <group>
      {markersVisible
        ? records.map((record) => (
            <ProjectMarker
              key={record.project.id}
              record={record}
              color={statusColor(projectStatusAt(record.project, viewTime))}
              selected={record.project.id === selectedProjectId}
              onSelect={onSelect}
            />
          ))
        : null}

      {showCompletion
        ? completionTargets.map((record) => (
            <LocalSceneTransform
              key={record.project.id}
              center={projectSceneCenter(record.project)}
            >
              <CompletionModel
                type={record.project.visual.completionType}
                dims={{
                  widthM: record.project.visual.siteWidthM,
                  depthM: record.project.visual.siteDepthM,
                  floors: record.project.visual.floors,
                }}
                mode={completionMode === "compare" ? "compare" : "planned"}
                selected={record.project.id === selectedProjectId}
              />
            </LocalSceneTransform>
          ))
        : null}
    </group>
  );
}
