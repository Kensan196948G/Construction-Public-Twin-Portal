/**
 * 影響イベント（交通規制・迂回路・歩道切替など）のデータセット。
 *
 * 仕様書 #9 のとおり Project とは別エンティティ。
 * 時間条件 `activeFrom <= viewTime <= activeTo` による表示判定を提供する。
 */
import { impactSchema, isImpactActiveAt, type Impact, type ImpactType, type ImpactSeverity } from "@/lib/schemas/impact";
import { RAW_IMPACTS, RAW_TYPE_TO_ENUM } from "./impact-defs";
import { getProjectById, getProjectBySlug, publicProjects } from "./projects";

/* ------------------------------------------------------------------ *
 * 構築
 * ------------------------------------------------------------------ */

function toImpact(rawId: string): Impact {
  const raw = RAW_IMPACTS.find((r) => r.id === rawId);
  if (!raw) throw new Error(`影響イベント原表が見つかりません: ${rawId}`);

  const project = getProjectById(raw.projectId);
  if (!project) throw new Error(`影響イベントの参照先工事が見つかりません: ${raw.projectId}`);

  const typeKey = RAW_TYPE_TO_ENUM[raw.type];
  if (!typeKey) throw new Error(`未知の影響イベント種別: ${raw.type}`);

  const slug = project.slug;
  const geometryUrl = raw.geom ? `/data/geo/${slug}/${raw.geom}.geojson` : undefined;

  const candidate = {
    id: raw.id,
    projectId: raw.projectId,
    type: typeKey as ImpactType,
    severity: raw.severity as ImpactSeverity,
    title: raw.title,
    description: raw.desc,
    activeFrom: raw.from,
    activeTo: raw.to,
    recurrence: raw.rec,
    geometryUrl,
    geometryKind: raw.geom,
    detourUrl:
      raw.geom === "detour" || project.visual.completionType === "road" || project.visual.completionType === "levee"
        ? `/data/geo/${slug}/detour.geojson`
        : undefined,
    source: {
      provider: project.source.provider,
      officialUrl: project.source.officialUrl,
      verifiedAt: project.source.verifiedAt,
      dataset: project.source.dataset,
      license: project.source.license,
    },
  };

  const parsed = impactSchema.safeParse(candidate);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" / ");
    throw new Error(`影響イベントデータが不正です (${raw.id}): ${detail}`);
  }
  return parsed.data;
}

export const ALL_IMPACTS: Impact[] = RAW_IMPACTS.map((r) => toImpact(r.id));

/* ------------------------------------------------------------------ *
 * アクセサ
 * ------------------------------------------------------------------ */

const BY_ID = new Map(ALL_IMPACTS.map((i) => [i.id, i]));

export function getImpactById(id: string): Impact | undefined {
  return BY_ID.get(id);
}

/** 公開案件に紐づく影響イベントのみ */
export function publicImpacts(): Impact[] {
  const publicIds = new Set(publicProjects().map((p) => p.id));
  return ALL_IMPACTS.filter((i) => publicIds.has(i.projectId));
}

export function impactsForProject(projectId: string): Impact[] {
  return publicImpacts().filter((i) => i.projectId === projectId);
}

/** プロジェクト slug から（詳細ページ用） */
export function impactsForSlug(slug: string): Impact[] {
  const project = getProjectBySlug(slug);
  if (!project) return [];
  return impactsForProject(project.id);
}

/** 指定日時に有効な影響イベント */
export function impactsActiveAt(viewTime: Date, projectId?: string): Impact[] {
  const base = projectId ? impactsForProject(projectId) : publicImpacts();
  return base.filter((i) => isImpactActiveAt(i, viewTime));
}

/** 種別ごとの件数 */
export function impactTypeCounts(impacts: Impact[] = publicImpacts()): { type: ImpactType; count: number }[] {
  const map = new Map<ImpactType, number>();
  for (const i of impacts) map.set(i.type, (map.get(i.type) ?? 0) + 1);
  return [...map.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/** 工種（日本語ラベル）ごとの件数 */
export function impactTypeLabelCounts(impacts: Impact[] = publicImpacts()) {
  const map = new Map<ImpactType, number>();
  for (const i of impacts) map.set(i.type, (map.get(i.type) ?? 0) + 1);
  return map;
}

/** 表示中の規制があるか（一覧の「規制中」フィルタ用） */
export function projectIdsWithActiveImpact(viewTime: Date): Set<string> {
  return new Set(impactsActiveAt(viewTime).map((i) => i.projectId));
}
