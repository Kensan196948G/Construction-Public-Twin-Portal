/**
 * Security Test — 公開ガード（apidata 担当）。
 *
 * 仕様書 #14 / docs/CONTRACTS.md §3.2:
 *   「公開状態が published 以外の案件は絶対に返さない」
 *
 * 実データはすべて公開状態なので、テスト内で非公開案件を生成して
 * ガード述語が必ず false を返すこと、および配信物（public/data/**）に
 * 非公開案件が混入していないことを検証する。
 * Route Handler 側の除外は `tests/api-security.test.ts` で別途検証する。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALL_PROJECTS,
  getProjectById,
  getProjectBySlug,
  isPubliclyVisible,
  publicProjects,
} from "@/lib/data/projects";
import { publicImpacts } from "@/lib/data/impacts";
import { PUBLICATION_STATES, type Project } from "@/lib/schemas/project";
import { projectWith } from "./fixtures/project";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(join(ROOT, ...segments), "utf8"));
}

const HIDDEN_ID = "sec-hidden-project";
const HIDDEN_SLUG = "sec-hidden-project";

describe("isPubliclyVisible（テスト内で生成した非公開案件）", () => {
  it("published かつ public のみ true", () => {
    expect(isPubliclyVisible(projectWith({ publicationState: "published" }))).toBe(true);
  });

  it("published 以外はすべて false", () => {
    for (const state of PUBLICATION_STATES) {
      if (state === "published") continue;
      const project: Project = projectWith({ publicationState: state });
      expect(isPubliclyVisible(project), `${state} は非公開のはず`).toBe(false);
      expect(project.visibility.publicationState).not.toBe("published");
    }
  });

  it("非公開案件は id / slug のどちらでも解決できない（404 の根拠）", () => {
    const hidden = projectWith({ id: HIDDEN_ID, slug: HIDDEN_SLUG, publicationState: "draft" });
    expect(hidden.id).toBe(HIDDEN_ID);
    // 生成した非公開案件はデータセットに含まれないため、公開アクセサからは解決できない
    expect(getProjectById(HIDDEN_ID)).toBeUndefined();
    expect(getProjectBySlug(HIDDEN_SLUG)).toBeUndefined();
  });
});

describe("publicProjects() の不変条件", () => {
  it("返る案件はすべて published かつ public", () => {
    const projects = publicProjects();
    expect(projects.length).toBeGreaterThan(0);
    for (const project of projects) {
      expect(project.visibility.publicationState).toBe("published");
      expect(project.visibility.classification).toBe("public");
      expect(isPubliclyVisible(project)).toBe(true);
    }
  });

  it("ALL_PROJECTS に対する公開フィルタと一致する", () => {
    expect(publicProjects().map((p) => p.id)).toEqual(
      ALL_PROJECTS.filter(isPubliclyVisible).map((p) => p.id),
    );
  });

  it("現在のデータセットに非公開案件は存在しない（回帰ガード）", () => {
    const hidden = ALL_PROJECTS.filter((p) => !isPubliclyVisible(p));
    expect(hidden.map((p) => p.id)).toEqual([]);
  });
});

describe("配信物への非公開案件の混入", () => {
  const publicIds = new Set(publicProjects().map((p) => p.id));

  it("public/data/projects/index.json は公開案件のみ", () => {
    const index = readJson("public", "data", "projects", "index.json") as {
      count: number;
      projects: { id: string }[];
    };
    expect(index.count).toBe(publicProjects().length);
    expect(index.projects.length).toBe(publicProjects().length);
    for (const summary of index.projects) {
      expect(publicIds.has(summary.id), `${summary.id} は非公開`).toBe(true);
    }
  });

  it("public/data/impacts/index.json は公開案件に紐づくもののみ", () => {
    const index = readJson("public", "data", "impacts", "index.json") as {
      count: number;
      impacts: { id: string; projectId: string }[];
    };
    expect(index.count).toBe(publicImpacts().length);
    for (const impact of index.impacts) {
      expect(publicIds.has(impact.projectId), `${impact.id} は非公開案件の影響`).toBe(true);
    }
  });

  it("public/data/geo/** は公開案件のみ", () => {
    const geoRoot = join(ROOT, "public", "data", "geo");
    const slugs = readdirSync(geoRoot).filter((name) => statSync(join(geoRoot, name)).isDirectory());
    expect(slugs).toContain("all");
    expect(slugs.filter((s) => s !== "all").sort()).toEqual(
      publicProjects()
        .map((p) => p.slug)
        .sort(),
    );

    const allFeatures = readJson("public", "data", "geo", "all", "workzone.geojson") as {
      features: { properties: { projectId: string } }[];
    };
    for (const feature of allFeatures.features) {
      expect(publicIds.has(feature.properties.projectId)).toBe(true);
    }
  });
});
