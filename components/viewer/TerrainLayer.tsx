"use client";

/**
 * 地形・地盤レイヤー。
 *
 * 都市モデル（LocalCityModel）の下に敷く地面と、
 * グリッド・等高線・遠景の丘陵で「地面がどこにあるか」を示す。
 * 外部データを使わないため、常に表示できる。
 */
import { useMemo } from "react";
import * as THREE from "three";

import {
  CONTOUR_RADII,
  SCENE_COLORS,
  buildMounds,
} from "@/lib/viewer/sceneBuilder";

export interface TerrainLayerProps {
  visible: boolean;
}

const GROUND_SIZE_M = 3600;

export function TerrainLayer({ visible }: TerrainLayerProps) {
  const mounds = useMemo(() => buildMounds(), []);

  if (!visible) return null;

  return (
    <group>
      {/* 地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
        <planeGeometry args={[GROUND_SIZE_M, GROUND_SIZE_M]} />
        <meshLambertMaterial color={SCENE_COLORS.ground} />
      </mesh>

      {/* 平面グリッド（100m 間隔） */}
      <gridHelper
        args={[GROUND_SIZE_M, 36, SCENE_COLORS.contour, SCENE_COLORS.contour]}
        position={[0, 0.03, 0]}
      />

      {/* 等高線（基準点からの距離） */}
      {CONTOUR_RADII.map((radius) => (
        <mesh key={radius} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
          <ringGeometry args={[radius - 1.2, radius, 160]} />
          <meshBasicMaterial
            color={SCENE_COLORS.terrain}
            transparent
            opacity={0.22}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}

      {/* 遠景の丘陵（都市モデルの外側のみ） */}
      {mounds.map((mound) => (
        <mesh
          key={`${mound.x}:${mound.z}`}
          position={[mound.x, -mound.height * 0.4, mound.z]}
          scale={[mound.radius, mound.height, mound.radius]}
        >
          <sphereGeometry args={[1, 24, 12]} />
          <meshLambertMaterial color={SCENE_COLORS.hill} />
        </mesh>
      ))}
    </group>
  );
}
