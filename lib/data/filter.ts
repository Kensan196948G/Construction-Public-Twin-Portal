/**
 * 工事の検索・絞り込み（F-001 / F-002 / F-003）。
 *
 * サーバー（Route Handler）とクライアント（一覧 UI）の双方から使う
 * 同型の純粋関数として実装する。同じ入力に対し同じ順序の結果を返す。
 */
import type { Project, ProjectCategory, ProjectStatus } from "@/lib/schemas/project";
import { isImpactActiveAt } from "@/lib/schemas/impact";
import { publicImpacts } from "./impacts";

/* ------------------------------------------------------------------ *
 * 正規化
 * ------------------------------------------------------------------ */

/** 全角/半角・大文字小文字・空白のゆれを吸収する */
export function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/** 検索対象テキストを案件から組み立てる */
export function searchableText(project: Project): string {
  return [
    project.name,
    project.publicTitle,
    project.purpose,
    project.benefits.join(" "),
    project.category,
    project.location.municipality,
    project.location.prefecture,
    project.location.city,
    project.location.ward,
    project.location.town,
    project.location.address,
    project.location.postalCode ?? "",
    project.owner.name,
    project.contractor.name,
    project.schedule.phase,
  ].join(" ");
}

/** 複数キーワード（空白区切り）の AND 検索 */
export function matchesKeyword(project: Project, keyword: string): boolean {
  const terms = keyword
    .split(/[\s\u3000]+/)
    .map(normalize)
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalize(searchableText(project));
  return terms.every((t) => haystack.includes(t));
}

/* ------------------------------------------------------------------ *
 * フィルタ
 * ------------------------------------------------------------------ */

export interface ProjectFilter {
  keyword?: string;
  category?: ProjectCategory | null;
  status?: ProjectStatus | null;
  /** 指定日時に有効な交通規制等を持つ案件のみ */
  regulatingOnly?: boolean;
  viewTime?: Date;
  municipality?: string;
  /** 工期が指定範囲と重なる案件のみ */
  from?: string;
  to?: string;
}

export function overlapsSchedule(project: Project, from?: string, to?: string): boolean {
  const start = Date.parse(project.schedule.startDate);
  const end = Date.parse(project.schedule.plannedEndDate);
  if (from && end < Date.parse(from)) return false;
  if (to && start > Date.parse(to)) return false;
  return true;
}

export function filterProjects(projects: Project[], filter: ProjectFilter): Project[] {
  const viewTime = filter.viewTime ?? new Date();
  const regulatingIds = filter.regulatingOnly
    ? new Set(publicImpacts().filter((i) => isImpactActiveAt(i, viewTime)).map((i) => i.projectId))
    : null;

  return projects.filter((p) => {
    if (filter.keyword && !matchesKeyword(p, filter.keyword)) return false;
    if (filter.category && p.category !== filter.category) return false;
    if (filter.status && p.status !== filter.status) return false;
    if (filter.municipality && p.location.municipality !== filter.municipality) return false;
    if (regulatingIds && !regulatingIds.has(p.id)) return false;
    if (!overlapsSchedule(p, filter.from, filter.to)) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * 検索サジェスト（トップバーの検索候補）
 * ------------------------------------------------------------------ */

export interface SearchSuggestion {
  projectId: string;
  slug: string;
  title: string;
  subtitle: string;
  kind: "name" | "municipality" | "category" | "address";
}

export function searchSuggestions(
  keyword: string,
  projects: Project[],
  limit = 8,
): SearchSuggestion[] {
  const q = normalize(keyword);
  if (!q) return [];

  const out: SearchSuggestion[] = [];
  const seen = new Set<string>();

  const push = (s: SearchSuggestion) => {
    const key = `${s.kind}:${s.title}:${s.projectId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  // 1. 工事件名・公開名称
  for (const p of projects) {
    if (normalize(p.name).includes(q) || normalize(p.publicTitle).includes(q)) {
      push({
        projectId: p.id,
        slug: p.slug,
        title: p.publicTitle,
        subtitle: `${p.name} / ${p.location.municipality}`,
        kind: "name",
      });
    }
  }

  // 2. 住所
  for (const p of projects) {
    if (normalize(p.location.address).includes(q)) {
      push({
        projectId: p.id,
        slug: p.slug,
        title: p.location.address,
        subtitle: p.publicTitle,
        kind: "address",
      });
    }
  }

  // 3. 自治体
  const municipalities = [...new Set(projects.map((p) => p.location.municipality))];
  for (const m of municipalities) {
    if (normalize(m).includes(q)) {
      push({
        projectId: "",
        slug: "",
        title: m,
        subtitle: "自治体で絞り込む",
        kind: "municipality",
      });
    }
  }

  // 4. 工種
  const categories = [...new Set(projects.map((p) => p.category))];
  for (const c of categories) {
    if (normalize(c).includes(q)) {
      push({ projectId: "", slug: "", title: c, subtitle: "工種で絞り込む", kind: "category" });
    }
  }

  return out.slice(0, limit);
}
