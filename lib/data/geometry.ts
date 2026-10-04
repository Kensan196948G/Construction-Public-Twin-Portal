/**
 * ローカル座標ジオメトリから GeoJSON FeatureCollection を生成する。
 *
 * 仕様書 #7 GeoJSON 表示仕様:
 *   工区 Polygon / MultiPolygon, 道路・河川 LineString, 車線規制 LineString,
 *   歩道切替 Polygon, 迂回路 LineString
 *
 * 生成物は `public/data/geo/**` へ書き出され、クライアントは
 * fetch() で実際に GeoJSON を読み込む（AC-007 の実証）。
 */
import { sceneToLngLat } from "@/lib/geo/transform";
import type { FeatureCollection, GeoJsonFeature, GeoJsonGeometry } from "@/lib/geo/geojson";
import { publicProjectRecords, type ProjectGeometry } from "./projects";
function toLngLat([x, z]: [number, number]): [number, number] {
  const { longitude, latitude } = sceneToLngLat(x, z);
  return [longitude, latitude];
}

function ringClosed(ring: [number, number][]): [number, number][] {
  const ll = ring.map(toLngLat);
  if (ll.length > 0) {
    const first = ll[0];
    const last = ll[ll.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ll.push([first[0], first[1]]);
  }
  return ll;
}

function line(pts: [number, number][]): [number, number][] {
  return pts.map(toLngLat);
}

/* ------------------------------------------------------------------ *
 * 個別ジオメトリ
 * ------------------------------------------------------------------ */

export type GeometryKind = "workzone" | "regulation" | "detour" | "pedestrian";

export function geometryOf(kind: GeometryKind, geom: ProjectGeometry): [number, number][] | null {
  switch (kind) {
    case "workzone":
      return geom.zone;
    case "regulation":
      return geom.regulation;
    case "detour":
      return geom.detour;
    case "pedestrian":
      return geom.pedestrian;
  }
}

export function geometryKindLabel(kind: GeometryKind): string {
  switch (kind) {
    case "workzone":
      return "工区";
    case "regulation":
      return "交通規制区間";
    case "detour":
      return "迂回路";
    case "pedestrian":
      return "歩道切替";
  }
}

function buildFeature(
  kind: GeometryKind,
  geom: ProjectGeometry,
  meta: {
    projectId: string;
    projectName: string;
    source: string;
    updatedAt: string;
    validFrom?: string;
    validTo?: string;
  },
): GeoJsonFeature | null {
  const pts = geometryOf(kind, geom);
  if (!pts || pts.length < 2) return null;

  let geometry: GeoJsonGeometry;
  if (kind === "workzone") {
    geometry = { type: "Polygon", coordinates: [ringClosed(pts)] };
  } else if (kind === "detour") {
    // 迂回路は閉ループなので LineString として外周をなぞる
    geometry = { type: "LineString", coordinates: line(pts) };
  } else {
    geometry = { type: "LineString", coordinates: line(pts) };
  }

  return {
    type: "Feature",
    id: `${meta.projectId}:${kind}`,
    geometry,
    properties: {
      id: `${meta.projectId}:${kind}`,
      projectId: meta.projectId,
      type: kind,
      name: `${meta.projectName} ${geometryKindLabel(kind)}`,
      validFrom: meta.validFrom,
      validTo: meta.validTo,
      source: meta.source,
      updatedAt: meta.updatedAt,
    },
  };
}

/* ------------------------------------------------------------------ *
 * コレクション
 * ------------------------------------------------------------------ */

export function buildProjectCollection(slug: string, kinds: GeometryKind[]): FeatureCollection {
  const record = publicProjectRecords().find((r) => r.project.slug === slug);
  if (!record) return { type: "FeatureCollection", features: [] };
  const { project, geometry } = record;

  const features = kinds
    .map((kind) =>
      buildFeature(kind, geometry, {
        projectId: project.id,
        projectName: project.publicTitle,
        source: project.source.provider,
        updatedAt: project.schedule.lastUpdatedAt,
        validFrom: project.schedule.startDate,
        validTo: project.schedule.plannedEndDate,
      }),
    )
    .filter((f): f is GeoJsonFeature => f !== null);

  return { type: "FeatureCollection", features };
}

/** 全公開案件の指定ジオメトリをまとめたコレクション */
export function buildAllCollection(kinds: GeometryKind[]): FeatureCollection {
  const features: GeoJsonFeature[] = [];
  for (const record of publicProjectRecords()) {
    for (const kind of kinds) {
      const f = buildFeature(kind, record.geometry, {
        projectId: record.project.id,
        projectName: record.project.publicTitle,
        source: record.project.source.provider,
        updatedAt: record.project.schedule.lastUpdatedAt,
        validFrom: record.project.schedule.startDate,
        validTo: record.project.schedule.plannedEndDate,
      });
      if (f) features.push(f);
    }
  }
  return { type: "FeatureCollection", features };
}

/** 全案件の代表点（Point）コレクション */
export function buildCentersCollection(): FeatureCollection {
  const features: GeoJsonFeature[] = publicProjectRecords().map(({ project }) => ({
    type: "Feature" as const,
    id: `${project.id}:center`,
    geometry: {
      type: "Point" as const,
      coordinates: [project.location.center.longitude, project.location.center.latitude],
    },
    properties: {
      id: `${project.id}:center`,
      projectId: project.id,
      type: "project_center",
      name: project.publicTitle,
      validFrom: project.schedule.startDate,
      validTo: project.schedule.plannedEndDate,
      source: project.source.provider,
      updatedAt: project.schedule.lastUpdatedAt,
    },
  }));
  return { type: "FeatureCollection", features };
}

/* ------------------------------------------------------------------ *
 * 書き出し対象の一覧（scripts/export-data.mjs と共有）
 * ------------------------------------------------------------------ */

export interface ExportTarget {
  path: string;
  collection: FeatureCollection;
}

export function exportTargets(): ExportTarget[] {
  const targets: ExportTarget[] = [];
  const kinds: GeometryKind[] = ["workzone", "regulation", "detour", "pedestrian"];

  for (const record of publicProjectRecords()) {
    for (const kind of kinds) {
      targets.push({
        path: `data/geo/${record.project.slug}/${kind}.geojson`,
        collection: buildProjectCollection(record.project.slug, [kind]),
      });
    }
  }

  targets.push({ path: "data/geo/all/workzone.geojson", collection: buildAllCollection(["workzone"]) });
  targets.push({ path: "data/geo/all/regulation.geojson", collection: buildAllCollection(["regulation"]) });
  targets.push({ path: "data/geo/all/detour.geojson", collection: buildAllCollection(["detour"]) });
  targets.push({ path: "data/geo/all/pedestrian.geojson", collection: buildAllCollection(["pedestrian"]) });
  targets.push({ path: "data/geo/all/centers.geojson", collection: buildCentersCollection() });

  return targets;
}
