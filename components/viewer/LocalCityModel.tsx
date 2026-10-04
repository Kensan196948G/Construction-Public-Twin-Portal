"use client";

/**
 * 内蔵の簡易 3D 都市モデル（手続き生成）。
 *
 * 外部タイル配信が無くても必ず表示できることが最優先の既定背景。
 * 出典: WebUI/koji-mieru-map-3d.html の init3D() の city / roads 構築部分。
 *
 * 街区・建物・街路樹は InstancedMesh でまとめて描画する
 * （街区 400 + 建物 900 程度を個別メッシュにすると描画コールが過多になるため）。
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import {
  ROADS,
  ROAD_DASH,
  SCENE_COLORS,
  dashSegments,
  type CityLayout,
  type Rect,
  type Segment,
} from "@/lib/viewer/sceneBuilder";

interface InstanceItem {
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
}

/** 箱型インスタンス群 */
function InstancedBoxes({ items, color }: { items: InstanceItem[]; color: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    items.forEach((item, index) => {
      position.set(item.position[0], item.position[1], item.position[2]);
      scale.set(item.scale[0], item.scale[1], item.scale[2]);
      const [rx, ry, rz] = item.rotation ?? [0, 0, 0];
      euler.set(rx, ry, rz);
      quaternion.setFromEuler(euler);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, items.length)]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial color={color} />
    </instancedMesh>
  );
}

/** 球インスタンス群（街路樹の樹冠） */
function InstancedSpheres({ items, color }: { items: InstanceItem[]; color: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    items.forEach((item, index) => {
      position.set(item.position[0], item.position[1], item.position[2]);
      scale.set(item.scale[0], item.scale[1], item.scale[2]);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, items.length)]}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshLambertMaterial color={color} />
    </instancedMesh>
  );
}

/** 円柱インスタンス群（街路樹の幹） */
function InstancedCylinders({ items, color }: { items: InstanceItem[]; color: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    items.forEach((item, index) => {
      position.set(item.position[0], item.position[1], item.position[2]);
      scale.set(item.scale[0], item.scale[1], item.scale[2]);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, items.length)]}>
      <cylinderGeometry args={[1, 1, 1, 6]} />
      <meshLambertMaterial color={color} />
    </instancedMesh>
  );
}

function rectItems(rects: readonly Rect[], y: number, height: number): InstanceItem[] {
  return rects.map((r) => ({
    position: [r.x, y, r.z],
    scale: [r.w, height, r.d],
  }));
}

/** 破線の区間を細い箱のインスタンスへ変換する */
function dashItems(segments: readonly Segment[], along: "x" | "z", y: number, width: number): InstanceItem[] {
  return segments.map((s) => {
    const length = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
    const midX = (s.a.x + s.b.x) / 2;
    const midZ = (s.a.z + s.b.z) / 2;
    return {
      position: [midX, y, midZ] as [number, number, number],
      scale: along === "x" ? [length, 0.16, width] : [width, 0.16, length],
      rotation: [0, 0, 0] as [number, number, number],
    };
  });
}

export interface LocalCityModelProps {
  layout: CityLayout;
  visible: boolean;
}

export function LocalCityModel({ layout, visible }: LocalCityModelProps) {
  const plateItems = useMemo(() => rectItems(layout.plates, 0.25, 0.5), [layout.plates]);
  const parkItems = useMemo(() => rectItems(layout.parks, 0.3, 0.6), [layout.parks]);

  const buildingGroups = useMemo(() => {
    const normal: InstanceItem[] = [];
    const alt: InstanceItem[] = [];
    const glass: InstanceItem[] = [];
    for (const b of layout.buildings) {
      const item: InstanceItem = {
        position: [b.x, b.h / 2 + 0.5, b.z],
        scale: [b.w, b.h, b.d],
      };
      if (b.glass) glass.push(item);
      else if (b.alt) alt.push(item);
      else normal.push(item);
    }
    return { normal, alt, glass };
  }, [layout.buildings]);

  const treeCrowns = useMemo(
    () =>
      layout.trees.map((t) => ({
        position: [t.x, 4.4 * t.scale + 1, t.z] as [number, number, number],
        scale: [2.6 * t.scale, 2.6 * t.scale, 2.6 * t.scale] as [number, number, number],
      })),
    [layout.trees],
  );

  const treeTrunks = useMemo(
    () =>
      layout.trees.map((t) => ({
        position: [t.x, 2, t.z] as [number, number, number],
        scale: [0.5, 3, 0.5] as [number, number, number],
      })),
    [layout.trees],
  );

  // 幹線道路のセンターライン（破線）
  const roadDashes = useMemo(() => {
    const half = ROADS.eastWest.lengthM / 2 - 10;
    const eastWest = dashSegments([{ x: -half, z: 0 }, { x: half, z: 0 }], ROAD_DASH.dash, ROAD_DASH.gap);
    const northSouth = dashSegments([{ x: 0, z: -half }, { x: 0, z: half }], ROAD_DASH.dash, ROAD_DASH.gap);
    return [...dashItems(eastWest, "x", 0.18, 0.9), ...dashItems(northSouth, "z", 0.18, 0.9)];
  }, []);

  if (!visible) return null;

  return (
    <group>
      {/* 街区プレート */}
      <InstancedBoxes items={plateItems} color={SCENE_COLORS.plate} />
      {/* 公園 */}
      <InstancedBoxes items={parkItems} color={SCENE_COLORS.park} />
      {/* 周辺建物 */}
      <InstancedBoxes items={buildingGroups.normal} color={SCENE_COLORS.building} />
      <InstancedBoxes items={buildingGroups.alt} color={SCENE_COLORS.buildingAlt} />
      <InstancedBoxes items={buildingGroups.glass} color={SCENE_COLORS.glass} />
      {/* 街路樹 */}
      <InstancedCylinders items={treeTrunks} color={SCENE_COLORS.treeTrunk} />
      <InstancedSpheres items={treeCrowns} color={SCENE_COLORS.treeCrown} />

      {/* 幹線道路（東西・南北） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, 0]}>
        <planeGeometry args={[ROADS.eastWest.lengthM, ROADS.eastWest.widthM]} />
        <meshBasicMaterial color={SCENE_COLORS.road} transparent opacity={0.92} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.16, 0]}>
        <planeGeometry args={[ROADS.northSouth.widthM, ROADS.northSouth.lengthM]} />
        <meshBasicMaterial color={SCENE_COLORS.road} transparent opacity={0.92} />
      </mesh>
      <InstancedBoxes items={roadDashes} color={SCENE_COLORS.roadPaint} />
    </group>
  );
}
