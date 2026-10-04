"use client";

/**
 * 完成予想モデル（手続き生成）。
 *
 * GLB を配置できない MVP では、`lib/viewer/sceneBuilder.ts` の
 * buildCompletionParts() が返す部品リスト（box / cylinder / sphere / cone）を
 * そのままメッシュへ展開する。8 種の completionType ごとに形が異なる。
 *
 * completionMode:
 *   current  … 表示しない（呼び出し側が描画しない）
 *   planned  … 通常表示
 *   compare  … 半透明で現在の工区と重ねる
 */
import { useMemo } from "react";
import { DoubleSide } from "three";

import type { CompletionType } from "@/lib/schemas/project";
import type { CompletionMode } from "@/lib/store/useAppStore";
import {
  buildCompletionParts,
  SCENE_COLORS,
  type CompletionDims,
  type ScenePart,
} from "@/lib/viewer/sceneBuilder";

export interface CompletionModelProps {
  type: CompletionType;
  dims: CompletionDims;
  mode: Exclude<CompletionMode, "current">;
  /** 選択中の案件か（主要素を強調する） */
  selected?: boolean;
}

function PartMaterial({ part, opacityScale }: { part: ScenePart; opacityScale: number }) {
  const opacity = (part.opacity ?? 1) * opacityScale;
  const transparent = opacity < 1;
  return (
    <meshLambertMaterial
      color={part.color}
      transparent={transparent}
      opacity={opacity}
      depthWrite={!transparent}
    />
  );
}

function PartMesh({ part, opacityScale }: { part: ScenePart; opacityScale: number }) {
  const rotation = part.rotation ?? [0, 0, 0];
  const shape = part.shape;

  switch (shape.kind) {
    case "box":
      return (
        <mesh position={part.position} rotation={rotation}>
          <boxGeometry args={shape.size} />
          <PartMaterial part={part} opacityScale={opacityScale} />
        </mesh>
      );
    case "cylinder": {
      const segments = shape.radialSegments ?? 16;
      return (
        <mesh position={part.position} rotation={rotation}>
          <cylinderGeometry args={[shape.radius, shape.radius, shape.height, segments]} />
          <PartMaterial part={part} opacityScale={opacityScale} />
        </mesh>
      );
    }
    case "sphere": {
      const segments = shape.radialSegments ?? 12;
      return (
        <mesh position={part.position} rotation={rotation}>
          <sphereGeometry args={[shape.radius, segments, Math.max(6, Math.round(segments / 2))]} />
          <PartMaterial part={part} opacityScale={opacityScale} />
        </mesh>
      );
    }
    case "cone": {
      const segments = shape.radialSegments ?? 12;
      return (
        <mesh position={part.position} rotation={rotation}>
          <coneGeometry args={[shape.radius, shape.height, segments]} />
          <PartMaterial part={part} opacityScale={opacityScale} />
        </mesh>
      );
    }
  }
}

export function CompletionModel({ type, dims, mode, selected = false }: CompletionModelProps) {
  const { widthM, depthM, floors } = dims;
  const parts = useMemo(
    () => buildCompletionParts(type, { widthM, depthM, floors }),
    [type, widthM, depthM, floors],
  );

  // compare は「現在と重ねる」ための半透明表示。
  const opacityScale = mode === "compare" ? (selected ? 0.55 : 0.4) : 1;

  return (
    <group>
      {parts.map((part) => (
        <PartMesh key={part.id} part={part} opacityScale={opacityScale} />
      ))}
      {/* 完成予想の基準面（案件の輪郭を示す薄い敷板） */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.32, 0]} visible={mode === "planned"}>
        <planeGeometry args={[Math.max(8, widthM * 1.04), Math.max(8, depthM * 1.04)]} />
        <meshBasicMaterial
          color={selected ? SCENE_COLORS.statusActive : SCENE_COLORS.completion}
          transparent
          opacity={selected ? 0.28 : 0.16}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}
