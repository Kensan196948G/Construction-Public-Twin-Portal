/**
 * 工事データセットの構築とアクセサ。
 *
 * - `lib/data/source.ts` の原表から Project を組み立て、Zod で検証する。
 * - 公開 API へは `published` 以外を返さない（仕様書 #14）。
 */
import {
  projectSchema,
  type Project,
  type ProjectSummary,
  type ProjectStatus,
  type ProjectCategory,
  type SiteType,
  type CompletionType,
  type PublicationState,
} from "@/lib/schemas/project";
import {
  CURATED_PROJECTS,
  SITE_TMPL,
  SITE_DEFS,
  LOC,
  PHOTO_FILES,
  PHOTO_CREDIT,
  SAMPLE_DISCLAIMER,
  OFFICIAL_PORTALS,
  type RawProject,
} from "./source";
import { impactIdsByProject } from "./impact-defs";
import { lngLatToScene } from "@/lib/geo/transform";

/* ------------------------------------------------------------------ *
 * 内部レコード（Project 本体 + ローカル座標ジオメトリ）
 * ------------------------------------------------------------------ */

export interface ProjectGeometry {
  /**
   * 工区リング（**案件中心を原点とする**ローカル座標 [x, z] メートル）。
   * シーン座標（基準点原点）へ変換するには `projectSceneOffset()` を加算すること。
   */
  zone: [number, number][];
  /** 規制線分（案件中心原点） */
  regulation: [number, number][] | null;
  /** 迂回ループ（案件中心原点） */
  detour: [number, number][] | null;
  /** 歩道切替線分（案件中心原点） */
  pedestrian: [number, number][] | null;
}

/**
 * 案件中心のシーン座標（基準点原点）オフセット。
 *
 * `ProjectGeometry` の各座標は案件中心を原点とするため、
 * 基準点を原点とするシーンへ配置する際は必ずこの値を加算する。
 */
export function projectSceneOffset(project: Project): { x: number; z: number } {
  const p = lngLatToScene(
    project.location.center.longitude,
    project.location.center.latitude,
  );
  return { x: p.x, z: p.z };
}

/**
 * 案件中心オフセットを適用したシーン座標のジオメトリを返す。
 * 3D ビューア・GeoJSON 生成の双方でこれを使い、座標の二重実装を避ける。
 */
export function sceneGeometryOf(
  kind: "zone" | "regulation" | "detour" | "pedestrian",
  record: ProjectRecord,
): [number, number][] | null {
  const raw = record.geometry[kind];
  if (!raw) return null;
  const { x: ox, z: oz } = projectSceneOffset(record.project);
  return raw.map(([x, z]) => [x + ox, z + oz] as [number, number]);
}

export interface ProjectRecord {
  project: Project;
  geometry: ProjectGeometry;
}

/* ------------------------------------------------------------------ *
 * 組み立て
 * ------------------------------------------------------------------ */

const STATUS_ORDER: Record<ProjectStatus, number> = {
  under_construction: 0,
  planned: 1,
  completed: 2,
  suspended: 3,
};

/** projectId → 影響イベント id 配列（原表から一度だけ構築する） */
const IMPACT_IDS = impactIdsByProject();

/** テンプレートから追加案件を生成する（プロトタイプの makeSites を移植） */
function buildGeneratedProjects(): RawProject[] {
  return SITE_DEFS.map((def) => {
    const t = SITE_TMPL[def.siteType];
    if (!t) throw new Error(`未知の siteType: ${def.siteType}`);

    const w = t.w;
    const d = t.d;
    const zone: [number, number][] = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ];

    const isArch = def.siteType.startsWith("arch");
    let regulation: [number, number][] | null = null;
    let detour: [number, number][] | null = null;
    let pedestrian: [number, number][] | null = null;

    if (isArch) {
      pedestrian = [
        [-w / 2, d / 2 - 4],
        [w / 2, d / 2 - 4],
      ];
    } else {
      regulation = [
        [-w / 2, 0],
        [w / 2, 0],
      ];
      detour = [
        [-w / 2 - 12, d / 2 + 8],
        [-w / 2 - 12, d / 2 + 26],
        [w / 2 + 12, d / 2 + 26],
        [w / 2 + 12, d / 2 + 8],
      ];
      pedestrian = [
        [-w / 2, d / 2 + 6],
        [w / 2, d / 2 + 6],
      ];
    }

    // ローカル座標 (x, z) → WGS84。source.ORIGIN を基準とする。
    const METERS_PER_DEG_LAT = 110540;
    const metersPerDegLon = 111320 * Math.cos((35.593 * Math.PI) / 180);
    const lon = 139.668 + def.x / metersPerDegLon;
    const lat = 35.593 - def.z / METERS_PER_DEG_LAT;

    return {
      id: def.id,
      slug: def.id,
      status: "under_construction",
      category: t.cat,
      siteType: def.siteType,
      name: def.name,
      publicTitle: def.publicTitle,
      purpose: t.purpose,
      benefits: [...t.benefits],
      owner: t.owner,
      contractor: t.contractor,
      start: def.start,
      end: def.end,
      phase: t.phase,
      updated: "2026-10-04T07:00:00+09:00",
      lon,
      lat,
      zone,
      regulation,
      detour,
      pedestrian,
      completion: t.completion,
      floors: t.floors,
    };
  });
}

function resolveMunicipality(loc: [string, string, string, string, string]): string {
  const [, , city, ward] = loc;
  return ward || city;
}

function resolveOfficialUrl(municipality: string): string {
  // 大田区の案件は実際の区ポータルを入口として提示する。
  // それ以外（サンプル上の架空自治体）は参考として国交省のページを案内する。
  return municipality === "大田区" ? OFFICIAL_PORTALS.ota : OFFICIAL_PORTALS.mlit;
}

function toProject(raw: RawProject): ProjectRecord {
  const loc = LOC[raw.id] ?? ["", "", "", "", raw.id];
  const [postalCode, prefecture, city, ward, town] = loc;
  const address = [prefecture, city, ward, town].filter(Boolean).join(" ");
  const municipality = resolveMunicipality(loc);

  const thumbnailUrl =
    PHOTO_FILES[raw.siteType]?.[0] ??
    PHOTO_FILES["civil-urban"][0];

  const widthM = Math.max(...raw.zone.map((p) => p[0])) - Math.min(...raw.zone.map((p) => p[0]));
  const depthM = Math.max(...raw.zone.map((p) => p[1])) - Math.min(...raw.zone.map((p) => p[1]));

  const candidate = {
    id: raw.id,
    slug: raw.slug,
    status: raw.status,
    category: raw.category,
    siteType: raw.siteType,
    name: raw.name,
    publicTitle: raw.publicTitle,
    purpose: raw.purpose,
    benefits: raw.benefits,
    owner: { name: raw.owner },
    contractor: { name: raw.contractor },
    schedule: {
      startDate: raw.start,
      plannedEndDate: raw.end,
      phase: raw.phase,
      lastUpdatedAt: raw.updated,
    },
    location: {
      postalCode: postalCode || undefined,
      prefecture,
      city,
      ward,
      town,
      address,
      municipality,
      center: { longitude: raw.lon, latitude: raw.lat },
      workZoneGeoJsonUrl: `/data/geo/${raw.slug}/workzone.geojson`,
    },
    visual: {
      thumbnailUrl,
      thumbnailCredit: PHOTO_CREDIT[thumbnailUrl],
      completionType: raw.completion,
      siteWidthM: widthM,
      siteDepthM: depthM,
      floors: raw.floors ?? 0,
    },
    impacts: IMPACT_IDS.get(raw.id) ?? [],
    visibility: {
      classification: "public" as const,
      publicationState: "published" as PublicationState,
      reviewDueAt: "2027-04-30",
    },
    source: {
      provider: raw.owner,
      officialUrl: resolveOfficialUrl(municipality),
      verifiedAt: "2026-10-04T07:00:00+09:00",
      dataset: "開発用サンプルデータ",
      license: "サンプル（写真は Wikimedia Commons、各クレジット参照）",
    },
    disclaimer: SAMPLE_DISCLAIMER,
  };

  const parsed = projectSchema.safeParse(candidate);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(" / ");
    throw new Error(`工事データが不正です (${raw.id}): ${detail}`);
  }

  return {
    project: parsed.data,
    geometry: {
      zone: raw.zone,
      regulation: raw.regulation,
      detour: raw.detour,
      pedestrian: raw.pedestrian,
    },
  };
}

/* ------------------------------------------------------------------ *
 * データセット
 * ------------------------------------------------------------------ */

const RAW_ALL: RawProject[] = [...CURATED_PROJECTS, ...buildGeneratedProjects()];

export const PROJECT_RECORDS: ProjectRecord[] = RAW_ALL.map(toProject).sort((a, b) => {
  const s = STATUS_ORDER[a.project.status] - STATUS_ORDER[b.project.status];
  if (s !== 0) return s;
  return b.project.schedule.startDate.localeCompare(a.project.schedule.startDate);
});

export const ALL_PROJECTS: Project[] = PROJECT_RECORDS.map((r) => r.project);

/* ------------------------------------------------------------------ *
 * 公開フィルタ（仕様書 #14）
 * ------------------------------------------------------------------ */

export function isPubliclyVisible(project: Project): boolean {
  return (
    project.visibility.publicationState === "published" &&
    project.visibility.classification === "public"
  );
}

/** 公開 API / UI に渡してよい案件のみ */
export function publicProjects(): Project[] {
  return ALL_PROJECTS.filter(isPubliclyVisible);
}

export function publicProjectRecords(): ProjectRecord[] {
  return PROJECT_RECORDS.filter((r) => isPubliclyVisible(r.project));
}

/* ------------------------------------------------------------------ *
 * アクセサ
 * ------------------------------------------------------------------ */

export function getProjectById(id: string): Project | undefined {
  return publicProjects().find((p) => p.id === id);
}

export function getProjectBySlug(slug: string): Project | undefined {
  return publicProjects().find((p) => p.slug === slug);
}

export function getProjectRecordById(id: string): ProjectRecord | undefined {
  return publicProjectRecords().find((r) => r.project.id === id);
}

export function getProjectRecordBySlug(slug: string): ProjectRecord | undefined {
  return publicProjectRecords().find((r) => r.project.slug === slug);
}

export function toSummary(project: Project): ProjectSummary {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    publicTitle: project.publicTitle,
    status: project.status,
    category: project.category,
    siteType: project.siteType,
    municipality: project.location.municipality,
    address: project.location.address,
    center: project.location.center,
    startDate: project.schedule.startDate,
    plannedEndDate: project.schedule.plannedEndDate,
    lastUpdatedAt: project.schedule.lastUpdatedAt,
    thumbnailUrl: project.visual.thumbnailUrl,
    impactCount: project.impacts.length,
  };
}

/** 工種ごとの件数（フィルタ UI 用） */
export function categoryCounts(projects: Project[] = publicProjects()): { category: ProjectCategory; count: number }[] {
  const map = new Map<ProjectCategory, number>();
  for (const p of projects) {
    map.set(p.category, (map.get(p.category) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, "ja"));
}

/** 施工状態ごとの件数 */
export function statusCounts(projects: Project[] = publicProjects()): { status: ProjectStatus; count: number }[] {
  const order: ProjectStatus[] = ["under_construction", "planned", "completed", "suspended"];
  const map = new Map<ProjectStatus, number>();
  for (const p of projects) map.set(p.status, (map.get(p.status) ?? 0) + 1);
  return order
    .filter((s) => (map.get(s) ?? 0) > 0)
    .map((status) => ({ status, count: map.get(status) ?? 0 }));
}

/** 自治体一覧 */
export function municipalities(projects: Project[] = publicProjects()): string[] {
  return [...new Set(projects.map((p) => p.location.municipality))].sort((a, b) =>
    a.localeCompare(b, "ja"),
  );
}

export function siteTypeOf(project: Project): SiteType {
  return project.siteType;
}

export function completionTypeOf(project: Project): CompletionType {
  return project.visual.completionType;
}
