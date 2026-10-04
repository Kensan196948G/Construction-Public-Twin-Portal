/**
 * Filter / Search Test — 検索・絞り込み（apidata 担当）。
 *
 * F-001 / F-002 / F-003。Route Handler と一覧 UI が共有する純粋関数を検証する。
 */
import { describe, expect, it } from "vitest";
import {
  filterProjects,
  matchesKeyword,
  normalize,
  overlapsSchedule,
  searchSuggestions,
  searchableText,
} from "@/lib/data/filter";
import { publicProjects, toSummary } from "@/lib/data/projects";
import { projectWith } from "./fixtures/project";

const ALL = publicProjects();
const VIEW_TIME = new Date("2026-10-15T12:00:00+09:00");

describe("normalize / matchesKeyword", () => {
  it("全角・大文字小文字・空白のゆれを吸収する", () => {
    expect(normalize("ＡＢＣ　Ｄ")).toBe("abcd");
    expect(normalize(" Test  Road ")).toBe("testroad");
  });

  it("複数キーワードは AND 検索になる", () => {
    const project = projectWith({ name: "Test Road Works", municipality: "テスト区" });
    expect(matchesKeyword(project, "test road")).toBe(true);
    expect(matchesKeyword(project, "ＴＥＳＴ")).toBe(true);
    expect(matchesKeyword(project, "test missing")).toBe(false);
    expect(matchesKeyword(project, "   ")).toBe(true);
  });

  it("検索対象テキストに工事件名・自治体・工種・住所が含まれる", () => {
    const project = ALL[0];
    const text = searchableText(project);
    expect(text).toContain(project.name);
    expect(text).toContain(project.publicTitle);
    expect(text).toContain(project.location.municipality);
    expect(text).toContain(project.category);
    expect(text).toContain(project.location.address);
  });
});

describe("filterProjects", () => {
  it("keyword で工事件名（publicTitle）を絞り込める", () => {
    const target = ALL.find((p) => p.publicTitle.includes("駅前広場")) ?? ALL[0];
    const results = filterProjects(ALL, { keyword: target.publicTitle });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((p) => p.id === target.id)).toBe(true);
    expect(results.every((p) => matchesKeyword(p, target.publicTitle))).toBe(true);
  });

  it("keyword で正式工事件名を絞り込める", () => {
    const target = ALL[0];
    const results = filterProjects(ALL, { keyword: target.name });
    expect(results.some((p) => p.id === target.id)).toBe(true);
  });

  it("keyword で自治体を絞り込める", () => {
    const results = filterProjects(ALL, { keyword: "大田区" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThan(ALL.length);
    expect(results.every((p) => matchesKeyword(p, "大田区"))).toBe(true);
  });

  it("keyword で工種（日本語カテゴリ）を絞り込める", () => {
    const results = filterProjects(ALL, { keyword: "公園" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => matchesKeyword(p, "公園"))).toBe(true);
  });

  it("category で絞り込める", () => {
    const results = filterProjects(ALL, { category: "公園" });
    expect(results.length).toBe(1);
    expect(results.every((p) => p.category === "公園")).toBe(true);
  });

  it("status で絞り込める", () => {
    for (const status of ["under_construction", "planned", "completed"] as const) {
      const results = filterProjects(ALL, { status });
      expect(results.length, status).toBeGreaterThan(0);
      expect(results.every((p) => p.status === status), status).toBe(true);
    }
  });

  it("municipality で絞り込める", () => {
    const target = "大田区";
    const results = filterProjects(ALL, { municipality: target });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => p.location.municipality === target)).toBe(true);
  });

  it("regulatingOnly は指定日時に有効な規制を持つ案件だけを返す", () => {
    const results = filterProjects(ALL, { regulatingOnly: true, viewTime: VIEW_TIME });
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThan(ALL.length);
    expect(results.every((p) => p.id !== undefined)).toBe(true);
  });

  it("regulatingOnly は時間帯によって結果が変わる", () => {
    // 全規制が始まる前（2025-01-01）には規制中の案件は無い
    const before = filterProjects(ALL, {
      regulatingOnly: true,
      viewTime: new Date("2025-01-01T00:00:00+09:00"),
    });
    expect(before.length).toBe(0);
  });

  it("from / to は工期の重なりで絞り込む", () => {
    expect(filterProjects(ALL, { from: "2028-01-01" }).length).toBe(0);
    expect(filterProjects(ALL, { to: "2025-01-01" }).length).toBe(0);
    const all = filterProjects(ALL, { from: "2020-01-01", to: "2030-01-01" });
    expect(all.length).toBe(ALL.length);
  });

  it("フィルタは入力順を保つ（決定的）", () => {
    const results = filterProjects(ALL, {});
    expect(results.map((p) => p.id)).toEqual(ALL.map((p) => p.id));
  });

  it("複数条件は AND で結合される", () => {
    const results = filterProjects(ALL, { category: "公園", status: "completed" });
    expect(results.every((p) => p.category === "公園" && p.status === "completed")).toBe(true);
  });
});

describe("overlapsSchedule", () => {
  it("工期レンジの重なりを判定する", () => {
    const project = ALL[0];
    const start = project.schedule.startDate;
    const end = project.schedule.plannedEndDate;
    expect(overlapsSchedule(project, start, end)).toBe(true);
    expect(overlapsSchedule(project, undefined, start)).toBe(true);
    expect(overlapsSchedule(project, end, undefined)).toBe(true);
    expect(overlapsSchedule(project, "2099-01-01", undefined)).toBe(false);
    expect(overlapsSchedule(project, undefined, "1999-01-01")).toBe(false);
  });
});

describe("searchSuggestions", () => {
  it("空クエリは候補ゼロ", () => {
    expect(searchSuggestions("", ALL)).toEqual([]);
    expect(searchSuggestions("   ", ALL)).toEqual([]);
  });

  it("工事件名・公開名称で候補が出る", () => {
    const target = ALL[0];
    const suggestions = searchSuggestions(target.publicTitle, ALL);
    expect(suggestions.some((s) => s.kind === "name" && s.projectId === target.id)).toBe(true);
  });

  it("自治体で「自治体で絞り込む」候補が出る（既定 8 件でも種別ごとに配分される）", () => {
    const suggestions = searchSuggestions("大田区", ALL);
    const municipality = suggestions.find((s) => s.kind === "municipality");
    expect(municipality).toBeDefined();
    expect(municipality?.title).toBe("大田区");
    expect(municipality?.projectId).toBe("");
  });

  it("工種で「工種で絞り込む」候補が出る", () => {
    const suggestions = searchSuggestions("公園", ALL);
    expect(suggestions.some((s) => s.kind === "category" && s.title === "公園")).toBe(true);
  });

  it("住所で候補が出る", () => {
    const target = ALL[0];
    const suggestions = searchSuggestions(target.location.address, ALL);
    expect(suggestions.some((s) => s.kind === "address")).toBe(true);
  });

  it("limit 件で打ち切られ、重複しない", () => {
    const target = ALL[0];
    const suggestions = searchSuggestions(target.location.address, ALL, 2);
    expect(suggestions.length).toBeLessThanOrEqual(2);
    const keys = suggestions.map((s) => `${s.kind}:${s.title}:${s.projectId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("該当なしは空配列", () => {
    expect(searchSuggestions("該当するはずのない語句ZZZ", ALL)).toEqual([]);
  });
});

describe("toSummary", () => {
  it("API 応答に必要な項目を過不足なく持つ", () => {
    const project = ALL[0];
    const summary = toSummary(project);
    expect(Object.keys(summary).sort()).toEqual(
      [
        "address",
        "category",
        "center",
        "id",
        "impactCount",
        "lastUpdatedAt",
        "municipality",
        "name",
        "plannedEndDate",
        "publicTitle",
        "siteType",
        "slug",
        "startDate",
        "status",
        "thumbnailUrl",
      ].sort(),
    );
    expect(summary.impactCount).toBe(project.impacts.length);
  });
});
