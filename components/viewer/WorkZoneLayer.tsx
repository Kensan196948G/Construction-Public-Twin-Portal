"use client";

/**
 * 工区レイヤー。
 *
 * `lib/data/projects.ts` の ProjectGeometry.zone（案件基準点からのローカル座標）を
 * そのままポリゴンとして描画する。色は「表示日時における施工状態」
 * （lib/viewer/sceneBuilder.ts の projectStatusAt）で決まる。
 *
 * クリックで selectProject() を呼び、カメラがその工区へ寄る。
 */
import { Line } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

import type { ProjectRecord } from "@/lib/data/projects";
import {
  closeRing,
  projectSceneCenter,
  projectStatusAt,
  statusColor,
  toLinePoints,
  type Vec2,
} from "@/lib/viewer/sceneBuilder";

import { LocalSceneTransform } from "./LocalSceneTransform";

/** 工区面の高さ（地面プレートの上） */
const ZONE_Y = 0.55;
/** 工区外周線の高さ */
const OUTLINE_Y = 0.95;

interface WorkZoneProps {
  record: ProjectRecord;
  color: number;
  selected: boolean;
  onSelect: (projectId: string) => void;
}

function WorkZone({ record, color, selected, onSelect }: WorkZoneProps) {
  const center = useMemo(() => projectSceneCenter(record.project), [record.project]);

  const shape = useMemo(() => {
    const s = new THREE.Shape();
    record.geometry.zone.forEach(([x, z], index) => {
      if (index === 0) s.moveTo(x, z);
      else s.lineTo(x, z);
    });
    s.closePath();
    return s;
  }, [record.geometry.zone]);

  const outline = useMemo(() => {
    const ring: Vec2[] = closeRing(record.geometry.zone.map(([x, z]) => ({ x, z })));
    return toLinePoints(ring, OUTLINE_Y);
  }, [record.geometry.zone]);

  return (
    <LocalSceneTransform center={center}>
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, ZONE_Y, 0]}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(record.project.id);
        }}
      >
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={selected ? 0.5 : 0.26}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* 選択中は工区を立体的に見せる（柱状のハイライト） */}
      {selected ? (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ZONE_Y + 0.02, 0]}>
          <shapeGeometry args={[shape]} />
          <meshBasicMaterial
            color={0xffffff}
            transparent
            opacity={0.18}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ) : null}

      <Line
        points={outline}
        color={color}
        lineWidth={selected ? 3.6 : 2}
        transparent
        opacity={selected ? 1 : 0.85}
      />
    </LocalSceneTransform>
  );
}

export interface WorkZoneLayerProps {
  records: readonly ProjectRecord[];
  viewTime: Date;
  selectedProjectId: string | null;
  visible: boolean;
  onSelect: (projectId: string) => void;
}

export function WorkZoneLayer({
  records,
  viewTime,
  selectedProjectId,
  visible,
  onSelect,
}: WorkZoneLayerProps) {
  if (!visible) return null;

  return (
    <group>
      {records.map((record) => (
        <WorkZone
          key={record.project.id}
          record={record}
          color={statusColor(projectStatusAt(record.project, viewTime))}
          selected={record.project.id === selectedProjectId}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}
