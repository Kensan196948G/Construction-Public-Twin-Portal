"use client";

/**
 * 現場3Dのデータレイヤー群（`lib/store/useAppStore.ts` の DATA_LAYERS 11種）。
 *
 * すべて `SiteModelData`（案件中心を原点とするローカル座標）を入力とし、
 * `<Canvas>` を含まない「シーンの中身」として描画する。
 * 呼び出し側（`SiteScene`）が `<group>` の中へ置く。
 *
 * 注意: 表示している形状は実データではなく、案件IDから決定的に生成した
 * **サンプル（合成）データ**である（`lib/site/sceneData.ts` 参照）。
 * 写真のみ実ファイル（public/images のサンプル。クレジットは PHOTO_CREDIT）。
 */
import { Line } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

import type { SiteModelData } from "@/lib/site/sceneData";
import type { DataLayerId } from "@/lib/store/useAppStore";
import {
  CAPTURE_PANEL,
  GAUSSIAN_LIMIT,
  PHOTO_LIMIT,
  POINTCLOUD_LIMIT,
  SITE_COLORS,
  SITE_LAYER_Y,
  aiPinColor,
  buildBimMembers,
  buildCadLines,
  buildGaussianCloud,
  buildPointCloudPositions,
  buildProgressBars,
  captureKindColor,
  inspectionColor,
  trajectoryPoints,
  type BimMember,
  type Vec3,
} from "@/lib/viewer/siteScene";

export type SiteVariant = "full" | "thumbnail";

/* ------------------------------------------------------------------ *
 * 写真テクスチャ（読み込み失敗でも例外を投げない）
 * ------------------------------------------------------------------ */

/** 同一URLの再読み込みを避ける（ギャラリーで24現場を連続描画しても増えない） */
const textureCache = new Map<string, THREE.Texture>();
const textureFailed = new Set<string>();

function useSafeTexture(url: string): THREE.Texture | null {
  // 初期値はキャッシュから解決する（effect 内での同期 setState を避ける）
  const [texture, setTexture] = useState<THREE.Texture | null>(
    () => textureCache.get(url) ?? null,
  );

  useEffect(() => {
    // 取得済み・失敗済みのURLは何もしない（再読み込みしない）
    if (textureCache.has(url) || textureFailed.has(url)) return;

    let cancelled = false;
    try {
      const loader = new THREE.TextureLoader();
      loader.load(
        url,
        (loaded) => {
          loaded.colorSpace = THREE.SRGBColorSpace;
          textureCache.set(url, loaded);
          if (cancelled) loaded.dispose();
          else setTexture(loaded);
        },
        undefined,
        () => {
          // 画像が無い環境でも3Dを止めない（プレースホルダを表示する）
          textureFailed.add(url);
          if (!cancelled) setTexture(null);
        },
      );
    } catch {
      textureFailed.add(url);
    }

    return () => {
      cancelled = true;
    };
  }, [url]);

  return texture;
}

/* ------------------------------------------------------------------ *
 * 1. BIM（柱・梁・床スラブ）
 * ------------------------------------------------------------------ */

function bimColor(member: BimMember): number {
  switch (member.kind) {
    case "column":
      return SITE_COLORS.bimColumn;
    case "beamX":
    case "beamZ":
      return SITE_COLORS.bimBeam;
    case "slab":
      return SITE_COLORS.bimSlab;
  }
}

function SiteBimLayer({ data, variant }: { data: SiteModelData; variant: SiteVariant }) {
  const members = useMemo(() => {
    const all = buildBimMembers(data);
    // サムネイルでは上層を間引いて負荷を下げる
    return variant === "thumbnail" ? all.filter((m) => m.floor <= 2) : all;
  }, [data, variant]);

  const slabOpacity = variant === "thumbnail" ? 0.5 : 0.62;

  return (
    <group>
      {members.map((member) =>
        member.kind === "slab" ? (
          <mesh key={member.id} position={member.position}>
            <boxGeometry args={member.size} />
            <meshLambertMaterial
              color={bimColor(member)}
              transparent
              opacity={slabOpacity}
              depthWrite={false}
            />
          </mesh>
        ) : (
          <mesh key={member.id} position={member.position}>
            <boxGeometry args={member.size} />
            <meshLambertMaterial color={bimColor(member)} />
          </mesh>
        ),
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * 2. CAD（平面図オーバーレイ）
 * ------------------------------------------------------------------ */

function SiteCadLayer({ data }: { data: SiteModelData }) {
  const lines = useMemo(() => buildCadLines(data), [data]);

  return (
    <group>
      {lines.map((line) => (
        <Line
          key={line.id}
          points={line.points}
          color={
            line.kind === "center"
              ? SITE_COLORS.cadCenter
              : line.kind === "grid"
                ? SITE_COLORS.cadGrid
                : SITE_COLORS.cadOutline
          }
          lineWidth={line.kind === "outline" ? 2.6 : line.kind === "center" ? 1.8 : 1.2}
          dashed={line.dashed}
          dashSize={4}
          gapSize={3}
          transparent
          opacity={line.kind === "dimension" ? 0.5 : 0.9}
        />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * 3. 点群
 * ------------------------------------------------------------------ */

function SitePointCloudLayer({ data, variant }: { data: SiteModelData; variant: SiteVariant }) {
  const geometry = useMemo(() => {
    const positions = buildPointCloudPositions(data, POINTCLOUD_LIMIT[variant]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.computeBoundingSphere();
    return g;
  }, [data, variant]);

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: SITE_COLORS.pointcloud,
        size: variant === "thumbnail" ? 0.34 : 0.22,
        sizeAttenuation: true,
      }),
    [variant],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return <points geometry={geometry} material={material} />;
}

/* ------------------------------------------------------------------ *
 * 4. 3DGS（ガウシアンスプラッティング相当）
 *
 * 点群（小さな不透明ドット）と見た目を明確に変えるため、
 * 加算合成・円形のソフトスプラット・高さ方向の色変化・1点ごとのサイズを持つ。
 * ------------------------------------------------------------------ */

const SPLAT_VERTEX_SHADER = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uScale / max(1.0, -mv.z), 1.0, 96.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const SPLAT_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float falloff = exp(-r2 * 9.0);
    gl_FragColor = vec4(vColor * falloff, falloff * 0.75);
  }
`;

function SiteGaussianLayer({ data, variant }: { data: SiteModelData; variant: SiteVariant }) {
  const cloud = useMemo(
    () => buildGaussianCloud(data, GAUSSIAN_LIMIT[variant]),
    [data, variant],
  );

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(cloud.sizes, 1));
    g.setAttribute("aColor", new THREE.BufferAttribute(cloud.colors, 3));
    g.computeBoundingSphere();
    return g;
  }, [cloud]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uScale: { value: 220 } },
        vertexShader: SPLAT_VERTEX_SHADER,
        fragmentShader: SPLAT_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

/* ------------------------------------------------------------------ *
 * 5. スマホ（撮影位置マーカー）
 * ------------------------------------------------------------------ */

function CaptureMarker({
  kind,
  position,
  index,
}: {
  kind: "smartphone" | "camera" | "uav";
  position: Vec3;
  index: number;
}) {
  const color = captureKindColor(kind);
  const [x, y, z] = position;

  return (
    <group position={[x, 0, z]}>
      {/* 地上からの支柱（どの高さの撮影かを示す） */}
      <mesh position={[0, y / 2, 0]}>
        <cylinderGeometry args={[0.12, 0.12, Math.max(0.4, y), 6]} />
        <meshLambertMaterial color={0x8a949e} />
      </mesh>
      <group position={[0, y, 0]}>
        {kind === "smartphone" ? (
          // スマホ = 薄い直方体
          <mesh rotation={[0, (index * Math.PI) / 3, 0]}>
            <boxGeometry args={[0.42, 0.82, 0.09]} />
            <meshLambertMaterial color={color} />
          </mesh>
        ) : kind === "camera" ? (
          // カメラ = 本体 + レンズ
          <group rotation={[0, (index * Math.PI) / 3, 0]}>
            <mesh>
              <boxGeometry args={[0.9, 0.7, 0.6]} />
              <meshLambertMaterial color={color} />
            </mesh>
            <mesh position={[0, 0, 0.42]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.24, 0.24, 0.34, 12]} />
              <meshLambertMaterial color={0x2b3038} />
            </mesh>
          </group>
        ) : (
          // UAV = 機体 + ローター
          <group>
            <mesh>
              <boxGeometry args={[0.9, 0.34, 0.9]} />
              <meshLambertMaterial color={color} />
            </mesh>
            {(
              [
                [0.62, 0.62],
                [-0.62, 0.62],
                [0.62, -0.62],
                [-0.62, -0.62],
              ] as const
            ).map(([rx, rz]) => (
              <mesh key={`${rx}:${rz}`} position={[rx, 0.16, rz]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.42, 0.42, 0.04, 14]} />
                <meshLambertMaterial color={0xdfe3e8} transparent opacity={0.75} />
              </mesh>
            ))}
          </group>
        )}
      </group>
    </group>
  );
}

function SiteCaptureLayer({ data }: { data: SiteModelData }) {
  return (
    <group>
      {data.captures.map((shot, index) => (
        <CaptureMarker
          key={shot.id}
          kind={shot.kind}
          position={shot.position}
          index={index}
        />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * 6. 写真（撮影位置に立てるパネル）
 * ------------------------------------------------------------------ */

function PhotoPanel({ shot, variant }: { shot: SiteModelData["captures"][number]; variant: SiteVariant }) {
  const texture = useSafeTexture(shot.photoUrl);

  const { position, rotation } = useMemo(() => {
    const [x, , z] = shot.position;
    const len = Math.hypot(x, z) || 1;
    // 撮影位置の少し外側に立て、現場中心へ正対させる
    const px = x + (x / len) * 2.8;
    const pz = z + (z / len) * 2.8;
    const yaw = Math.atan2(-px, -pz);
    return {
      position: [px, CAPTURE_PANEL.height / 2 + 0.7, pz] as Vec3,
      rotation: [0, yaw, 0] as Vec3,
    };
  }, [shot.position]);

  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <planeGeometry args={[CAPTURE_PANEL.width, CAPTURE_PANEL.height]} />
        {texture ? (
          <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />
        ) : (
          // 画像が読めない環境向けのプレースホルダ（例外は投げない）
          <meshBasicMaterial
            color={SITE_COLORS.photo}
            transparent
            opacity={0.42}
            side={THREE.DoubleSide}
          />
        )}
      </mesh>
      {variant === "full" ? (
        <>
          {/* パネルの枠 */}
          <mesh position={[0, 0, -0.03]}>
            <planeGeometry args={[CAPTURE_PANEL.width + 0.2, CAPTURE_PANEL.height + 0.2]} />
            <meshBasicMaterial color={0x2b3038} transparent opacity={0.55} />
          </mesh>
          {/* 地面までの支柱 */}
          <mesh position={[0, -(CAPTURE_PANEL.height / 2 + 0.35), 0]}>
            <cylinderGeometry args={[0.09, 0.09, 0.9, 6]} />
            <meshLambertMaterial color={0x8a949e} />
          </mesh>
        </>
      ) : null}
    </group>
  );
}

function SitePhotoLayer({ data, variant }: { data: SiteModelData; variant: SiteVariant }) {
  const shots = useMemo(() => data.captures.slice(0, PHOTO_LIMIT[variant]), [data, variant]);

  return (
    <group>
      {shots.map((shot) => (
        <PhotoPanel key={`photo-${shot.id}`} shot={shot} variant={variant} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * 7. 施工進捗
 * ------------------------------------------------------------------ */

function SiteProgressLayer({ data }: { data: SiteModelData }) {
  const bars = useMemo(() => buildProgressBars(data), [data]);

  return (
    <group>
      {bars.map((bar) => (
        <group key={bar.id}>
          <mesh position={bar.base.position}>
            <boxGeometry args={bar.base.size} />
            <meshLambertMaterial
              color={SITE_COLORS.progressPending}
              transparent
              opacity={bar.state === "pending" ? 0.75 : 0.35}
              depthWrite={false}
            />
          </mesh>
          {bar.fill ? (
            <mesh position={bar.fill.position}>
              <boxGeometry args={bar.fill.size} />
              <meshLambertMaterial color={bar.color} />
            </mesh>
          ) : null}
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * 8. 点検 / 9. AI・指摘ピン
 * ------------------------------------------------------------------ */

function Pin({
  position,
  color,
  shape,
}: {
  position: Vec3;
  color: number;
  shape: "sphere" | "octahedron";
}) {
  const [x, y, z] = position;
  const poleTop = Math.max(0.3, y - 0.55);

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, poleTop / 2, 0]}>
        <cylinderGeometry args={[0.09, 0.09, poleTop, 6]} />
        <meshLambertMaterial color={0x8a949e} />
      </mesh>
      {shape === "sphere" ? (
        <mesh position={[0, y, 0]}>
          <sphereGeometry args={[0.52, 14, 10]} />
          <meshLambertMaterial color={color} />
        </mesh>
      ) : (
        <mesh position={[0, y, 0]} rotation={[0, Math.PI / 4, 0]}>
          <octahedronGeometry args={[0.72, 0]} />
          <meshLambertMaterial color={color} />
        </mesh>
      )}
    </group>
  );
}

function SiteInspectionLayer({ data }: { data: SiteModelData }) {
  return (
    <group>
      {data.inspections.map((record) => (
        <Pin
          key={record.id}
          position={record.position}
          color={inspectionColor(record.status)}
          shape="sphere"
        />
      ))}
    </group>
  );
}

function SiteAiPinLayer({ data }: { data: SiteModelData }) {
  return (
    <group>
      {data.pins.map((pin) => (
        <Pin
          key={pin.id}
          position={pin.position}
          color={aiPinColor(pin.severity)}
          shape="octahedron"
        />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * 10. 撮影軌跡
 * ------------------------------------------------------------------ */

function SiteTrajectoryLayer({ data }: { data: SiteModelData }) {
  const points = useMemo(() => trajectoryPoints(data), [data]);
  if (points.length < 2) return null;

  return (
    <group>
      <Line
        points={points}
        color={SITE_COLORS.trajectory}
        lineWidth={2.2}
        dashed
        dashSize={5}
        gapSize={4}
        transparent
        opacity={0.9}
      />
      {points.map((point, index) => (
        <mesh key={`traj-${index}`} position={point}>
          <sphereGeometry args={[0.22, 8, 6]} />
          <meshBasicMaterial color={SITE_COLORS.trajectory} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * オーケストレータ
 * ------------------------------------------------------------------ */

export interface SiteDataLayersProps {
  data: SiteModelData;
  /**
   * full = 通常表示 / thumbnail = ギャラリー用の軽量表示
   * （点群・3DGS の点数を減らし、写真枚数と BIM の階数を絞る）
   */
  variant: SiteVariant;
  /** 表示するデータレイヤー（DATA_LAYERS の ON/OFF） */
  layers: Record<DataLayerId, boolean>;
}

/**
 * `dataLayers` に応じて11種のデータレイヤーを描画する。
 * レイヤーの高さは重ならないよう `SITE_LAYER_Y` で調整してある。
 */
export function SiteDataLayers({ data, variant, layers }: SiteDataLayersProps) {
  return (
    <group>
      {layers.bim ? <SiteBimLayer data={data} variant={variant} /> : null}
      {layers.cad ? <SiteCadLayer data={data} /> : null}
      {layers.pointcloud ? <SitePointCloudLayer data={data} variant={variant} /> : null}
      {layers.gaussian ? <SiteGaussianLayer data={data} variant={variant} /> : null}
      {layers.smartphone ? <SiteCaptureLayer data={data} /> : null}
      {layers.photo ? <SitePhotoLayer data={data} variant={variant} /> : null}
      {layers.progress ? <SiteProgressLayer data={data} /> : null}
      {layers.inspection ? <SiteInspectionLayer data={data} /> : null}
      {layers.aiPin ? <SiteAiPinLayer data={data} /> : null}
      {layers.trajectory ? <SiteTrajectoryLayer data={data} /> : null}
      {/*
        gis はここでは描かない。SiteScene が既存の
        工区 / 車線規制 / 迂回路 / 歩道切替（＝GIS 相当）をまとめて制御する。
      */}
    </group>
  );
}
