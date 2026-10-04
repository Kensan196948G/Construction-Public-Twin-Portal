"use client";

/**
 * カメラ制御（軌道操作 + プリセット + 工区フォーカス）。
 *
 * 出典: WebUI/koji-mieru-map-3d.html の Orbit クラス（球面座標 theta/phi/r を
 * 毎フレーム補間して滑らかに移動する）。three.js の OrbitControls ではなく
 * 自前で持つことで、プリセット適用・フォーカス移動・ユーザー操作を
 * 同じ補間ループにまとめている。
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
  DEFAULT_CAMERA_TARGET,
  cameraPositionFor,
  clampDistance,
  clampPhi,
  focusDistanceFor,
  presetById,
  type CameraPresetId,
} from "@/lib/viewer/cameraPresets";

/** フォーカス対象（選択中の工区） */
export interface CameraFocus {
  x: number;
  z: number;
  /** 工区の代表半径 (m) */
  radius: number;
}

/** プリセット適用の指示。nonce は同じプリセットの再適用を検知するための番号。 */
export interface CameraCommand {
  preset: CameraPresetId;
  nonce: number;
}

interface OrbitState {
  targetX: number;
  targetY: number;
  targetZ: number;
  distance: number;
  theta: number;
  phi: number;
}

const OVERVIEW = presetById("overview");

/** 角度の補間（-π..π の近い側を通す） */
function lerpAngle(current: number, desired: number, k: number): number {
  const twoPi = Math.PI * 2;
  let delta = (desired - current) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return current + delta * k;
}

function initialState(): OrbitState {
  return {
    targetX: DEFAULT_CAMERA_TARGET.x,
    targetY: DEFAULT_CAMERA_TARGET.y,
    targetZ: DEFAULT_CAMERA_TARGET.z,
    distance: OVERVIEW.distance,
    theta: OVERVIEW.theta,
    phi: OVERVIEW.phi,
  };
}

export interface CameraControllerProps {
  focus: CameraFocus | null;
  command: CameraCommand;
}

export function CameraController({ focus, command }: CameraControllerProps) {
  const camera = useThree((state) => state.camera);
  const domElement = useThree((state) => state.gl.domElement);

  const current = useRef<OrbitState>(initialState());
  const desired = useRef<OrbitState>(initialState());

  const focusX = focus?.x ?? null;
  const focusZ = focus?.z ?? null;
  const focusRadius = focus?.radius ?? null;

  // 工事選択 → 工区へ寄る
  useEffect(() => {
    const target = desired.current;
    target.targetY = DEFAULT_CAMERA_TARGET.y;
    if (focusX !== null && focusZ !== null) {
      target.targetX = focusX;
      target.targetZ = focusZ;
      target.distance = focusDistanceFor(focusRadius ?? 40);
    } else {
      target.targetX = DEFAULT_CAMERA_TARGET.x;
      target.targetZ = DEFAULT_CAMERA_TARGET.z;
      target.distance = OVERVIEW.distance;
    }
  }, [focusX, focusZ, focusRadius]);

  // プリセット適用
  useEffect(() => {
    const preset = presetById(command.preset);
    const target = desired.current;
    target.distance = preset.distance;
    target.theta = preset.theta;
    target.phi = preset.phi;
  }, [command]);

  // ポインタ・ホイール操作
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
        const k = current.current.distance * 0.0016;
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
    const cur = current.current;
    const target = desired.current;
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
