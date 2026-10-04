"use client";

/**
 * 工区ローカル座標 → シーン座標の変換を担うグループ。
 *
 * 工事データ（`lib/data/projects.ts` の ProjectGeometry）は
 * 「案件の基準点からのローカル座標 [x, z] メートル」で定義されている。
 * 子要素をこのグループへ入れると、子はローカル座標のまま記述できる。
 *
 *   <LocalSceneTransform center={center}>
 *     <mesh position={[x, 0.6, z]}>…</mesh>
 *   </LocalSceneTransform>
 *
 * X = 東西(+が東), Y = 高さ, Z = 南北(+が南) は lib/geo/transform.ts と同じ規約。
 */
import { useMemo, type ReactNode } from "react";

import type { Project } from "@/lib/schemas/project";
import { projectSceneCenter, type Vec2 } from "@/lib/viewer/sceneBuilder";

export interface LocalSceneTransformProps {
  /** 案件の基準点（シーン座標） */
  center: Vec2;
  /** 地面からの持ち上げ (m)。既定 0。 */
  elevation?: number;
  children?: ReactNode;
}

export function LocalSceneTransform({ center, elevation = 0, children }: LocalSceneTransformProps) {
  return <group position={[center.x, elevation, center.z]}>{children}</group>;
}

/** 案件の基準点（シーン座標）。Project が変わらない限り再計算しない。 */
export function useProjectSceneCenter(project: Project): Vec2 {
  return useMemo(() => projectSceneCenter(project), [project]);
}
