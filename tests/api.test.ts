/**
 * API Test — Route Handler を直接 import して検証する（apidata 担当）。
 *
 * サーバー起動不要。`new Request()` を渡してステータスと応答形を確認する。
 * 応答形は docs/CONTRACTS.md §3.2 の凍結仕様に一致すること。
 */
import { describe, expect, it } from "vitest";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectDetailRoute from "@/app/api/projects/[id]/route";
import * as impactsRoute from "@/app/api/impacts/route";
import * as searchRoute from "@/app/api/search/route";
import * as tilesetsRoute from "@/app/api/tilesets/route";
import type { FeatureCollection } from "@/lib/geo/geojson";
import type { Impact } from "@/lib/schemas/impact";
import type { Project, ProjectSummary } from "@/lib/schemas/project";
import type { SearchSuggestion } from "@/lib/data/filter";
import type { TilesetConfig } from "@/lib/viewer/tileConfig";
import { publicImpacts } from "@/lib/data/impacts";
import { publicProjects } from "@/lib/data/projects";
import { isImpactActiveAt } from "@/lib/schemas/impact";

interface ProjectsResponse {
  count: number;
  total: number;
  at: string;
  projects: ProjectSummary[];
}
interface ProjectDetailResponse {
  project: Project;
  geometry: FeatureCollection;
  impacts: Impact[];
}
interface ImpactsResponse {
  count: number;
  at: string;
  impacts: Impact[];
}
interface SearchResponse {
  query: string;
  count: number;
  suggestions: SearchSuggestion[];
}
interface TilesetsResponse {
  defaultSource: string;
  tilesets: TilesetConfig[];
}
interface ErrorResponse {
  error: string;
}

const PUBLIC = publicProjects();
const SAMPLE = PUBLIC[0];

function req(path: string, params: Record<string, string | number | undefined> = {}): Request {
  const url = new URL(`http://localhost${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return new Request(url);
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("動的レンダリングの明示", () => {
  it("全 Route Handler が force-dynamic を export している", () => {
    expect(projectsRoute.dynamic).toBe("force-dynamic");
    expect(projectDetailRoute.dynamic).toBe("force-dynamic");
    expect(impactsRoute.dynamic).toBe("force-dynamic");
    expect(searchRoute.dynamic).toBe("force-dynamic");
    expect(tilesetsRoute.dynamic).toBe("force-dynamic");
  });
});

describe("GET /api/projects", () => {
  it("無条件なら公開案件の全件を返す", async () => {
    const response = await projectsRoute.GET(req("/api/projects"));
    expect(response.status).toBe(200);

    const body = await readJson<ProjectsResponse>(response);
    expect(body.count).toBe(PUBLIC.length);
    expect(body.total).toBe(PUBLIC.length);
    expect(body.projects.length).toBe(PUBLIC.length);
    expect(typeof body.at).toBe("string");
    expect(Number.isNaN(Date.parse(body.at))).toBe(false);
  });

  it("ProjectSummary の必須項目が揃っている", async () => {
    const body = await readJson<ProjectsResponse>(await projectsRoute.GET(req("/api/projects")));
    for (const project of body.projects) {
      expect(typeof project.id).toBe("string");
      expect(typeof project.slug).toBe("string");
      expect(typeof project.publicTitle).toBe("string");
      expect(typeof project.municipality).toBe("string");
      expect(typeof project.impactCount).toBe("number");
      expect(typeof project.center.longitude).toBe("number");
    }
  });

  it("keyword で絞り込める（count < total）", async () => {
    const keyword = SAMPLE.publicTitle;
    const body = await readJson<ProjectsResponse>(
      await projectsRoute.GET(req("/api/projects", { keyword })),
    );
    expect(body.count).toBeGreaterThan(0);
    expect(body.count).toBeLessThan(PUBLIC.length);
    expect(body.projects.some((p) => p.id === SAMPLE.id)).toBe(true);
  });

  it("category / status / municipality の単一条件が効く", async () => {
    const byCategory = await readJson<ProjectsResponse>(
      await projectsRoute.GET(req("/api/projects", { category: "公園" })),
    );
    expect(byCategory.count).toBe(1);
    expect(byCategory.projects.every((p) => p.category === "公園")).toBe(true);

    const byStatus = await readJson<ProjectsResponse>(
      await projectsRoute.GET(req("/api/projects", { status: "completed" })),
    );
    expect(byStatus.count).toBeGreaterThan(0);
    expect(byStatus.projects.every((p) => p.status === "completed")).toBe(true);

    const byMunicipality = await readJson<ProjectsResponse>(
      await projectsRoute.GET(req("/api/projects", { municipality: "大田区" })),
    );
    expect(byMunicipality.count).toBeGreaterThan(0);
    expect(byMunicipality.projects.every((p) => p.municipality === "大田区")).toBe(true);
  });

  it("at / regulating=true で指定日時に規制中の案件だけになる", async () => {
    const at = "2026-10-15T12:00:00+09:00";
    const body = await readJson<ProjectsResponse>(
      await projectsRoute.GET(req("/api/projects", { regulating: "true", at })),
    );
    expect(body.at).toBe(new Date(at).toISOString());
    expect(body.count).toBeGreaterThan(0);
    expect(body.count).toBeLessThan(PUBLIC.length);
    expect(body.projects.every((p) => p.impactCount > 0)).toBe(true);
  });

  it("limit は件数を制限し、total は絞り込み後の全件数を保つ", async () => {
    const body = await readJson<ProjectsResponse>(
      await projectsRoute.GET(req("/api/projects", { limit: 5 })),
    );
    expect(body.count).toBe(5);
    expect(body.projects.length).toBe(5);
    expect(body.total).toBe(PUBLIC.length);
  });

  it("from / to の範囲外は 0 件", async () => {
    const body = await readJson<ProjectsResponse>(
      await projectsRoute.GET(req("/api/projects", { from: "2028-01-01" })),
    );
    expect(body.count).toBe(0);
    expect(body.total).toBe(0);
    expect(body.projects).toEqual([]);
  });

  it("不正なクエリは 400 { error }", async () => {
    const cases: Record<string, string>[] = [
      { category: "存在しない工種" },
      { status: "unknown_status" },
      { regulating: "maybe" },
      { limit: "abc" },
      { limit: "0" },
      { limit: "9999" },
      { at: "not-a-date" },
      { from: "2026/01/01" },
      { to: "2026-13-45" },
      { to: "2026-02-30" },
      { from: "2026-04-31" },
    ];
    for (const params of cases) {
      const response = await projectsRoute.GET(req("/api/projects", params));
      expect(response.status, JSON.stringify(params)).toBe(400);
      const body = await readJson<ErrorResponse>(response);
      expect(typeof body.error, JSON.stringify(params)).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);
    }
  });

  it("未知のクエリパラメータは無視される（400 にしない）", async () => {
    const response = await projectsRoute.GET(req("/api/projects", { unknown: "x" }));
    expect(response.status).toBe(200);
  });
});

describe("GET /api/projects/[id]", () => {
  const invoke = (id: string) =>
    projectDetailRoute.GET(req(`/api/projects/${encodeURIComponent(id)}`), {
      params: Promise.resolve({ id }),
    });

  it("slug で解決できる", async () => {
    const response = await invoke(SAMPLE.slug);
    expect(response.status).toBe(200);
    const body = await readJson<ProjectDetailResponse>(response);
    expect(body.project.id).toBe(SAMPLE.id);
    expect(body.project.slug).toBe(SAMPLE.slug);
    expect(body.project.visibility.publicationState).toBe("published");
  });

  it("id でも解決できる", async () => {
    const body = await readJson<ProjectDetailResponse>(await invoke(SAMPLE.id));
    expect(body.project.id).toBe(SAMPLE.id);
  });

  it("geometry は工区の FeatureCollection", async () => {
    const body = await readJson<ProjectDetailResponse>(await invoke(SAMPLE.slug));
    expect(body.geometry.type).toBe("FeatureCollection");
    expect(body.geometry.features.length).toBeGreaterThan(0);
    expect(body.geometry.features[0].geometry.type).toBe("Polygon");
    expect(body.geometry.features[0].properties.projectId).toBe(SAMPLE.id);
  });

  it("impacts は公開案件に紐づく影響イベント", async () => {
    const body = await readJson<ProjectDetailResponse>(await invoke(SAMPLE.slug));
    expect(Array.isArray(body.impacts)).toBe(true);
    for (const impact of body.impacts) {
      expect(impact.projectId).toBe(SAMPLE.id);
    }
  });

  it("未発見は 404 { error }（id / slug のどちらでも）", async () => {
    for (const id of ["no-such-project", "存在しない案件"]) {
      const response = await invoke(id);
      expect(response.status, id).toBe(404);
      const body = await readJson<ErrorResponse>(response);
      expect(body.error).toContain(id);
    }
  });
});

describe("GET /api/impacts", () => {
  it("無条件なら公開案件の影響イベント全件", async () => {
    const response = await impactsRoute.GET(req("/api/impacts"));
    expect(response.status).toBe(200);
    const body = await readJson<ImpactsResponse>(response);
    expect(body.count).toBe(publicImpacts().length);
    expect(body.impacts.length).toBe(body.count);
    expect(Number.isNaN(Date.parse(body.at))).toBe(false);
  });

  it("projectId で絞り込める", async () => {
    const projectId = publicImpacts()[0].projectId;
    const body = await readJson<ImpactsResponse>(
      await impactsRoute.GET(req("/api/impacts", { projectId })),
    );
    expect(body.count).toBeGreaterThan(0);
    expect(body.impacts.every((i) => i.projectId === projectId)).toBe(true);
  });

  it("type で絞り込める", async () => {
    const body = await readJson<ImpactsResponse>(
      await impactsRoute.GET(req("/api/impacts", { type: "lane_closure" })),
    );
    expect(body.count).toBeGreaterThan(0);
    expect(body.impacts.every((i) => i.type === "lane_closure")).toBe(true);
  });

  it("activeAt で指定日時に有効なものだけになる", async () => {
    const at = "2026-10-15T12:00:00+09:00";
    const body = await readJson<ImpactsResponse>(
      await impactsRoute.GET(req("/api/impacts", { activeAt: at })),
    );
    const viewTime = new Date(at);
    expect(body.at).toBe(viewTime.toISOString());
    expect(body.count).toBeGreaterThan(0);
    expect(body.count).toBeLessThan(publicImpacts().length);
    for (const impact of body.impacts) {
      expect(isImpactActiveAt(impact, viewTime)).toBe(true);
    }
  });

  it("activeAt 未指定なら at は現在時刻を返す", async () => {
    const body = await readJson<ImpactsResponse>(await impactsRoute.GET(req("/api/impacts")));
    expect(Math.abs(Date.parse(body.at) - Date.now())).toBeLessThan(60_000);
  });

  it("不正なクエリは 400", async () => {
    for (const params of [{ type: "unknown_type" }, { activeAt: "nope" }, { projectId: "" }]) {
      const response = await impactsRoute.GET(req("/api/impacts", params));
      expect(response.status, JSON.stringify(params)).toBe(400);
    }
  });
});

describe("GET /api/search", () => {
  it("query と suggestions を返す", async () => {
    const response = await searchRoute.GET(req("/api/search", { q: "大田区" }));
    expect(response.status).toBe(200);
    const body = await readJson<SearchResponse>(response);
    expect(body.query).toBe("大田区");
    expect(body.count).toBe(body.suggestions.length);
    expect(body.count).toBeGreaterThan(0);
    expect(body.count).toBeLessThanOrEqual(8);
    for (const suggestion of body.suggestions) {
      expect(["name", "municipality", "category", "address"]).toContain(suggestion.kind);
    }
  });

  it("工事件名で検索すると kind: name の候補が返る", async () => {
    const body = await readJson<SearchResponse>(
      await searchRoute.GET(req("/api/search", { q: SAMPLE.publicTitle })),
    );
    expect(body.suggestions.some((s) => s.kind === "name" && s.projectId === SAMPLE.id)).toBe(true);
  });

  it("候補は projectId / slug / title / subtitle / kind を持つ", async () => {
    const body = await readJson<SearchResponse>(
      await searchRoute.GET(req("/api/search", { q: SAMPLE.publicTitle })),
    );
    expect(body.count).toBeGreaterThan(0);
    for (const suggestion of body.suggestions) {
      expect(typeof suggestion.title).toBe("string");
      expect(typeof suggestion.subtitle).toBe("string");
      expect(["name", "municipality", "category", "address"]).toContain(suggestion.kind);
    }
  });

  it("q 未指定・空文字は候補ゼロ（400 にしない）", async () => {
    for (const params of [{}, { q: "" }, { q: "   " }]) {
      const response = await searchRoute.GET(req("/api/search", params));
      expect(response.status, JSON.stringify(params)).toBe(200);
      const body = await readJson<SearchResponse>(response);
      expect(body.count).toBe(0);
    }
  });

  it("契約外の limit パラメータは無視される（既定 8 件で打ち切る）", async () => {
    const body = await readJson<SearchResponse>(
      await searchRoute.GET(req("/api/search", { q: "大田区", limit: 1 })),
    );
    expect(body.count).toBeGreaterThan(1);
    expect(body.count).toBeLessThanOrEqual(8);
  });

  it("長すぎる q は 400", async () => {
    const response = await searchRoute.GET(req("/api/search", { q: "あ".repeat(201) }));
    expect(response.status).toBe(400);
  });
});

describe("GET /api/tilesets", () => {
  it("defaultSource は local、tilesets は設定を返す", async () => {
    const response = await tilesetsRoute.GET();
    expect(response.status).toBe(200);
    const body = await readJson<TilesetsResponse>(response);
    expect(body.defaultSource).toBe("local");
    expect(body.tilesets.length).toBeGreaterThanOrEqual(2);
    expect(body.tilesets.some((t) => t.id === "local-procedural")).toBe(true);
  });

  it("ローカル背景は常に configured / verified である", async () => {
    const body = await readJson<TilesetsResponse>(await tilesetsRoute.GET());
    const local = body.tilesets.find((t) => t.id === "local-procedural");
    expect(local?.configured).toBe(true);
    expect(local?.verified).toBe(true);
  });

  it("各 tileset が必須項目を持つ", async () => {
    const body = await readJson<TilesetsResponse>(await tilesetsRoute.GET());
    for (const tileset of body.tilesets) {
      for (const key of [
        "id",
        "name",
        "provider",
        "area",
        "dataset",
        "license",
        "attribution",
      ] as const) {
        expect(typeof tileset[key], `${tileset.id}.${key}`).toBe("string");
        expect(tileset[key].length, `${tileset.id}.${key}`).toBeGreaterThan(0);
      }
      expect(typeof tileset.url).toBe("string");
      expect(typeof tileset.configured).toBe("boolean");
      expect(typeof tileset.verified).toBe("boolean");
    }
  });
});
