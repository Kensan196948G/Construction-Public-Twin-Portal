/**
 * API Security Test — Route Handler が「公開状態 published 以外を返さない」ことを、
 * 非公開案件を混ぜたモックデータセットで検証する（apidata 担当）。
 *
 * 実データはすべて published のため、公開ガードが実際に効いているかは
 * データを差し替えないと確認できない。ここでは `@/lib/data/projects` を
 * 部分的にモックし、`ALL_PROJECTS` に draft を混入させる。
 *   - ルートが `publicProjects()` ではなく `ALL_PROJECTS` を使っていれば、
 *     非公開案件が応答に現れてテストが落ちる。
 */
import { describe, expect, it, vi } from "vitest";

const FIXTURE = vi.hoisted(() => ({
  draftId: "sec-draft-project",
  draftSlug: "sec-draft-project",
  publishedId: "sec-published-project",
  publishedSlug: "sec-published-project",
}));

vi.mock("@/lib/data/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/projects")>();
  const { projectWith } = await import("./fixtures/project");

  const published = projectWith({
    id: FIXTURE.publishedId,
    slug: FIXTURE.publishedSlug,
    name: "公開テスト案件（道路改良工事）",
    publicTitle: "公開テスト案件",
  });
  const draft = projectWith({
    id: FIXTURE.draftId,
    slug: FIXTURE.draftSlug,
    name: "非公開テスト案件（道路改良工事）",
    publicTitle: "非公開テスト案件",
    publicationState: "draft",
  });
  const all = [published, draft];

  return {
    ...actual,
    // 非公開案件を含む「生のデータセット」
    ALL_PROJECTS: all,
    // 公開フィルタを適用したもの（実装と同じ述語を使う）
    publicProjects: () => all.filter(actual.isPubliclyVisible),
    publicProjectRecords: () => [],
    getProjectById: (id: string) =>
      all.find((p) => p.id === id && actual.isPubliclyVisible(p)) ?? actual.getProjectById(id),
    getProjectBySlug: (slug: string) =>
      all.find((p) => p.slug === slug && actual.isPubliclyVisible(p)) ??
      actual.getProjectBySlug(slug),
  };
});

import { ALL_PROJECTS, publicProjects } from "@/lib/data/projects";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectDetailRoute from "@/app/api/projects/[id]/route";

interface ProjectsResponse {
  count: number;
  total: number;
  at: string;
  projects: { id: string; slug: string }[];
}

function req(path: string): Request {
  return new Request(`http://localhost${path}`);
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("モックデータセットの前提", () => {
  it("ALL_PROJECTS には非公開案件が含まれる", () => {
    expect(ALL_PROJECTS.map((p) => p.id)).toContain(FIXTURE.draftId);
    expect(ALL_PROJECTS.find((p) => p.id === FIXTURE.draftId)?.visibility.publicationState).toBe(
      "draft",
    );
  });

  it("publicProjects() はテスト内で作った非公開案件を除外する", () => {
    const ids = publicProjects().map((p) => p.id);
    expect(ids).toContain(FIXTURE.publishedId);
    expect(ids).not.toContain(FIXTURE.draftId);
  });
});

describe("GET /api/projects は非公開案件を返さない", () => {
  it("応答に draft の id / slug が現れない", async () => {
    const response = await projectsRoute.GET(req("/api/projects"));
    expect(response.status).toBe(200);

    const body = await readJson<ProjectsResponse>(response);
    expect(body.total).toBe(1);
    expect(body.count).toBe(1);

    const ids = body.projects.map((p) => p.id);
    const slugs = body.projects.map((p) => p.slug);
    expect(ids).toContain(FIXTURE.publishedId);
    expect(ids).not.toContain(FIXTURE.draftId);
    expect(slugs).not.toContain(FIXTURE.draftSlug);
  });

  it("keyword で非公開案件の名称を指定しても 0 件", async () => {
    const response = await projectsRoute.GET(
      new Request(
        `http://localhost/api/projects?keyword=${encodeURIComponent("非公開テスト案件")}`,
      ),
    );
    const body = await readJson<ProjectsResponse>(response);
    expect(body.count).toBe(0);
    expect(body.projects).toEqual([]);
  });
});

describe("GET /api/projects/[id] は非公開案件を解決しない", () => {
  const invoke = (id: string) =>
    projectDetailRoute.GET(req(`/api/projects/${encodeURIComponent(id)}`), {
      params: Promise.resolve({ id }),
    });

  it("draft の id では 404", async () => {
    const response = await invoke(FIXTURE.draftId);
    expect(response.status).toBe(404);
    const body = await readJson<{ error: string }>(response);
    expect(body.error).toContain(FIXTURE.draftId);
  });

  it("draft の slug では 404", async () => {
    const response = await invoke(FIXTURE.draftSlug);
    expect(response.status).toBe(404);
  });

  it("published の id / slug では 200 で返る", async () => {
    for (const id of [FIXTURE.publishedId, FIXTURE.publishedSlug]) {
      const response = await invoke(id);
      expect(response.status, id).toBe(200);
      const body = await readJson<{
        project: { id: string; visibility: { publicationState: string } };
        geometry: { type: string };
      }>(response);
      expect(body.project.id).toBe(FIXTURE.publishedId);
      expect(body.project.visibility.publicationState).toBe("published");
      expect(body.geometry.type).toBe("FeatureCollection");
    }
  });
});
