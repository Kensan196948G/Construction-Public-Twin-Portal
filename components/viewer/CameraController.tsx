"use client";

/**
 * カメラ制御（軌道操作 + プリセット + 工区フォーカス）。
 *
 * 出典: WebUI/koji-mieru-map-3d.html の Orbit クラス（球面座標 theta/phi/r を
 * 毎フレーム補間して滑らかに移動する）。three.js の OrbitControls ではなく
 * 自前で持つことで、プリセット適用・フォーカス移動・ユーザー操作を
 * 同じ補間ループにまとめている。
 *
 * 設計上の要点（2026-10-04 改訂）:
 *   カメラの行き先は **親が `intent` として決める**。このコンポーネントは
 *   `intent.key` が変わったときだけ距離・角度を適用し直し、注視点は毎フレーム同期する。
 *   React の effect に依存せず `useFrame` 内で完結するため、
 *   React StrictMode による effect の二重実行でも結果が変わらない
 *   （以前は effect + ref ガードで実装しており、StrictMode で
 *   カメラ距離が復元されない不具合があった）。
 *
 * 操作:
 *   ドラッグ         … 回転
 *   Shift+ドラッグ / 右ドラッグ … 平行移動
 *   ホイール         … ズーム（VIEWER_LIMITS の範囲内）
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import {
  cameraPositionFor,
  clampDistance,
  clampPhi,
  type CameraPresetId,
  type Vec3Like,
} from "@/lib/viewer/cameraPresets";

/** カメラの行き先（親が決める） */
export interface CameraIntent {
  /**
   * 「行き先が変わった」ことを示すキー。
   * 例: `${scope}:${projectId}:${presetId}:${nonce}`
   * これが変わると distance / theta / phi を適用し直す（手動操作の結果は保つ）。
   */
  key: string;
  /** 注視点 */
  target: Vec3Like;
  /** 注視点からの距離 (m) */
  distance: number;
  /** 方位角 (rad) */
  theta: number;
  /** 天頂角 (rad) */
  phi: number;
}

interface OrbitState {
  targetX: number;
  targetY: number;
  targetZ: number;
  distance: number;
  theta: number;
  phi: number;
}

/** 角度の補間（-π..π の近い側を通す） */
function lerpAngle(current: number, desired: number, k: number): number {
  const twoPi = Math.PI * 2;
  let delta = (desired - current) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return current + delta * k;
}

function orbitFrom(intent: CameraIntent): OrbitState {
  return {
    targetX: intent.target.x,
    targetY: intent.target.y,
    targetZ: intent.target.z,
    distance: clampDistance(intent.distance),
    theta: intent.theta,
    phi: clampPhi(intent.phi),
  };
}

/** プリセット適用の指示。nonce は同じプリセットの再適用を検知するための番号。 */
export interface CameraCommand {
  preset: CameraPresetId;
  nonce: number;
}

export interface CameraControllerProps {
  intent: CameraIntent;
}

export function CameraController({ intent }: CameraControllerProps) {
  const camera = useThree((state) => state.camera);
  const domElement = useThree((state) => state.gl.domElement);

  /** 現在の画角（補間中の実測値。ユーザー操作でも書き換わる） */
  const current = useRef<OrbitState | null>(null);
  /** 親が決めた行き先（ユーザーのパン・ズームもここへ反映する） */
  const desired = useRef<OrbitState>(orbitFrom(intent));
  /** 適用済みの行き先キー */
  const appliedKey = useRef<string | null>(null);

  // ポインタ・ホイール操作（操作結果は `desired` へ直接反映する）
  useEffect(() => {
    const element = domElement;
    if (!element) return;

    let dragging = false;
    let panning = false;
    let lastX = 0;
    let lastY = 0;
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      panning = event.button === 2 || event.shiftKey;
      lastX = event.clientX;
      lastY = event.clientY;
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // ポインタキャプチャ非対応の環境ではそのまま続行する
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;

      const target = desired.current;
      if (panning) {
        right.setFromMatrixColumn(camera.matrix, 0);
        up.setFromMatrixColumn(camera.matrix, 1);
        const k = target.distance * 0.0016;
        target.targetX += (-right.x * dx + up.x * dy) * k;
        target.targetY += (-right.y * dx + up.y * dy) * k;
        target.targetZ += (-right.z * dx + up.z * dy) * k;
        // 地面より下へは潜らない
        target.targetY = Math.max(0, target.targetY);
      } else {
        target.theta -= dx * 0.005;
        target.phi = clampPhi(target.phi - dy * 0.005);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      try {
        element.releasePointerCapture(event.pointerId);
      } catch {
        // 同上
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const target = desired.current;
      target.distance = clampDistance(target.distance * Math.exp(event.deltaY * 0.0011));
    };

    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerUp);
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("contextmenu", onContextMenu);

    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("contextmenu", onContextMenu);
    };
  }, [camera, domElement]);

  useFrame((_, delta) => {
    const cur = current.current ?? (current.current = { ...desired.current });
    const target = desired.current;

    // 親が決めた注視点は毎フレーム同期する（冪等）
    target.targetX = intent.target.x;
    target.targetY = intent.target.y;
    target.targetZ = intent.target.z;
    // 距離・角度は「行き先が変わったとき」だけ適用し直す
    if (appliedKey.current !== intent.key) {
      appliedKey.current = intent.key;
      target.distance = clampDistance(intent.distance);
      target.theta = intent.theta;
      target.phi = clampPhi(intent.phi);
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // フレームレートに依存しない補間（60fps で 0.16/フレーム相当）
    const k = reduceMotion ? 1 : 1 - Math.pow(1 - 0.16, Math.min(delta, 0.1) * 60);

    cur.targetX += (target.targetX - cur.targetX) * k;
    cur.targetY += (target.targetY - cur.targetY) * k;
    cur.targetZ += (target.targetZ - cur.targetZ) * k;
    cur.distance = clampDistance(cur.distance + (target.distance - cur.distance) * k);
    cur.theta = lerpAngle(cur.theta, target.theta, k);
    cur.phi = clampPhi(cur.phi + (target.phi - cur.phi) * k);

    const position = cameraPositionFor(
      { x: cur.targetX, y: cur.targetY, z: cur.targetZ },
      cur,
    );
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(cur.targetX, cur.targetY, cur.targetZ);
  });

  return null;
}
