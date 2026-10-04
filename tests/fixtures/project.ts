/**
 * テスト用の Project / Impact フィクスチャ（apidata 担当）。
 *
 * 実データ（lib/data/source.ts）とは独立した「検証用の最小構成」。
 * スキーマ検証・改ざん検知・公開ガードのテストから共有する。
 */
import {
  impactSchema,
  type Impact,
} from "@/lib/schemas/impact";
import {
  projectSchema,
  type Classification,
  type Project,
  type PublicationState,
} from "@/lib/schemas/project";

/** 検証を通る Project の素案（そのまま safeParse できる object） */
export function projectCandidate(): Record<string, unknown> {
  return {
    id: "test-project-0001",
    slug: "test-project-0001",
    status: "under_construction",
    category: "道路",
    siteType: "civil-urban",
    name: "テスト用 道路改良工事",
    publicTitle: "テスト用 道路を改良する工事",
    purpose: "テスト用の目的です。歩行空間を広げます。",
    benefits: ["歩道の拡幅", "段差の解消"],
    owner: { name: "テスト市 建設部" },
    contractor: { name: "テスト建設株式会社" },
    schedule: {
      startDate: "2026-04-01",
      plannedEndDate: "2027-03-31",
      phase: "舗装工事",
      lastUpdatedAt: "2026-10-04T07:00:00+09:00",
    },
    location: {
      postalCode: "100-0001",
      prefecture: "東京都",
      city: "",
      ward: "テスト区",
      town: "テスト一丁目 1-1",
      address: "東京都 テスト区 テスト一丁目 1-1",
      municipality: "テスト区",
      center: { longitude: 139.668, latitude: 35.593 },
      workZoneGeoJsonUrl: "/data/geo/test-project-0001/workzone.geojson",
    },
    visual: {
      thumbnailUrl: "/photos/test.jpg",
      thumbnailCredit: {
        author: "テスト撮影者",
        license: "CC BY 4.0",
        url: "https://example.com/credits/test",
      },
      completionType: "road",
      siteWidthM: 60,
      siteDepthM: 24,
      floors: 0,
    },
    impacts: ["test-impact-0001"],
    visibility: {
      classification: "public",
      publicationState: "published",
      reviewDueAt: "2027-04-30",
    },
    source: {
      provider: "テスト市 建設部",
      officialUrl: "https://example.com/official",
      verifiedAt: "2026-10-04T07:00:00+09:00",
      dataset: "テスト用サンプルデータ",
      license: "サンプル",
    },
    disclaimer: "本データはテスト用のサンプルです。",
  };
}

/** 検証を通る Impact の素案 */
export function impactCandidate(): Record<string, unknown> {
  return {
    id: "test-impact-0001",
    projectId: "test-project-0001",
    type: "lane_closure",
    severity: "notice",
    title: "テスト用 車線規制",
    description: "テスト用の車線規制です。",
    activeFrom: "2026-06-01",
    activeTo: "2026-06-30",
    recurrence: "終日",
    geometryUrl: "/data/geo/test-project-0001/regulation.geojson",
    geometryKind: "regulation",
    source: {
      provider: "テスト市 建設部",
      officialUrl: "https://example.com/official",
      verifiedAt: "2026-10-04T07:00:00+09:00",
      dataset: "テスト用サンプルデータ",
      license: "サンプル",
    },
  };
}

export function validProject(): Project {
  return projectSchema.parse(projectCandidate());
}

export function validImpact(): Impact {
  return impactSchema.parse(impactCandidate());
}

export interface ProjectOverrides {
  id?: string;
  slug?: string;
  name?: string;
  publicTitle?: string;
  purpose?: string;
  municipality?: string;
  publicationState?: PublicationState;
  classification?: Classification;
  widthM?: number;
}

/** 一部だけ差し替えた Project を作る（公開ガードのテスト用） */
export function projectWith(overrides: ProjectOverrides = {}): Project {
  const base = projectCandidate();
  const visibility = { ...(base.visibility as Record<string, unknown>) };
  if (overrides.publicationState) visibility.publicationState = overrides.publicationState;
  if (overrides.classification) visibility.classification = overrides.classification;

  const location = { ...(base.location as Record<string, unknown>) };
  if (overrides.municipality) location.municipality = overrides.municipality;

  const visual = { ...(base.visual as Record<string, unknown>) };
  if (typeof overrides.widthM === "number") visual.siteWidthM = overrides.widthM;

  return projectSchema.parse({
    ...base,
    ...(overrides.id ? { id: overrides.id } : {}),
    ...(overrides.slug ? { slug: overrides.slug } : {}),
    ...(overrides.name ? { name: overrides.name } : {}),
    ...(overrides.publicTitle ? { publicTitle: overrides.publicTitle } : {}),
    ...(overrides.purpose ? { purpose: overrides.purpose } : {}),
    location,
    visual,
    visibility,
  });
}
