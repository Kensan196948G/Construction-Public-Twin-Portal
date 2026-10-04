/**
 * 自社現場台帳（PostGIS / 静的フォールバック）の検証。
 *
 * PostGIS が未構成の環境（DATABASE_URL 未設定）では
 * API が静的データで同じ検索意味を返すことを保証する。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as ledgerRoute from "@/app/api/ledger/route";
import * as nearbyRoute from "@/app/api/geo/nearby/route";
import * as containsRoute from "@/app/api/geo/contains/route";
import * as healthRoute from "@/app/api/health/route";
import {
  searchStaticLedger,
  staticLedgerEntries,
  staticLedgerFacets,
} from "@/lib/data/ledger";
import { ledgerFromProject, orderNoOf, sequenceFromId } from "@/lib/schemas/ledger";
import { getProjectById, publicProjects } from "@/lib/data/projects";

const DEFAULT_QUERY = { limit: 50, offset: 0 };

/** 田園調布駅前広場（工区の中心付近） */
const PLAZA = { longitude: 139.6679, latitude: 35.593 };

let savedDatabaseUrl: string | undefined;

beforeEach(() => {
  savedDatabaseUrl = process.env.DATABASE_URL;
  // 静的フォールバック経路を検証するため、DB を明示的に無効化する。
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDatabaseUrl;
});

describe("ledgerFromProject", () => {
  it("すべての公開案件が台帳スキーマを満たす", () => {
    const entries = staticLedgerEntries();
    expect(entries).toHaveLength(publicProjects().length);
    for (const entry of entries) {
      expect(entry.projectId).toBeTruthy();
      expect(entry.officialName).toBeTruthy();
      expect(entry.center.longitude).toBeGreaterThan(120);
      expect(entry.isSample).toBe(true);
    }
  });

  it("発注番号は PRJ-<着工年>-<5桁> の形式で決定的に生成される", () => {
    const project = getProjectById("tokyo-demo-002")!;
    const orderNo = orderNoOf(project);
    expect(orderNo).toMatch(/^PRJ-\d{4}-\d{5}$/);
    expect(orderNo.startsWith(`PRJ-${project.schedule.startDate.slice(0, 4)}`)).toBe(true);
    // 同じ入力からは常に同じ値
    expect(orderNoOf(project)).toBe(orderNo);
    expect(sequenceFromId(project.id)).toHaveLength(5);
  });

  it("JV は建築系のみ設定し、土木・道路系は null にする", () => {
    const arch = staticLedgerEntries().find((e) => e.category.startsWith("建築"));
    const civil = staticLedgerEntries().find((e) => !e.category.startsWith("建築"));
    expect(arch?.jvName).toContain("建設共同企業体");
    expect(civil?.jvName).toBeNull();
  });

  it("ledgerFromProject は Project と整合する", () => {
    const project = getProjectById("tokyo-demo-002")!;
    const entry = ledgerFromProject(project);
    expect(entry.officialName).toBe(project.name);
    expect(entry.ownerName).toBe(project.owner.name);
    expect(entry.contractorName).toBe(project.contractor.name);
    expect(entry.address).toBe(project.location.address);
    expect(entry.startDate).toBe(project.schedule.startDate);
  });
});

describe("searchStaticLedger", () => {
  it("現場IDで検索できる", () => {
    const result = searchStaticLedger({ ...DEFAULT_QUERY, keyword: "tokyo-demo-002" });
    expect(result.total).toBe(1);
    expect(result.entries[0].projectId).toBe("tokyo-demo-002");
  });

  it("発注番号で検索できる", () => {
    const target = staticLedgerEntries()[0];
    const result = searchStaticLedger({ ...DEFAULT_QUERY, keyword: target.orderNo });
    expect(result.entries.some((e) => e.orderNo === target.orderNo)).toBe(true);
  });

  it("工事件名・公開名称で検索できる", () => {
    const target = staticLedgerEntries()[0];
    const result = searchStaticLedger({ ...DEFAULT_QUERY, keyword: target.publicTitle });
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it("発注者・元請で検索できる", () => {
    const target = staticLedgerEntries()[0];
    const byOwner = searchStaticLedger({ ...DEFAULT_QUERY, owner: target.ownerName });
    expect(byOwner.total).toBeGreaterThanOrEqual(1);
    const byContractor = searchStaticLedger({
      ...DEFAULT_QUERY,
      contractor: target.contractorName,
    });
    expect(byContractor.total).toBeGreaterThanOrEqual(1);
  });

  it("JV 案件のみに絞り込める", () => {
    const result = searchStaticLedger({ ...DEFAULT_QUERY, jvOnly: true });
    expect(result.total).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.jvName !== null)).toBe(true);
  });

  it("工期の範囲で絞り込める", () => {
    const all = staticLedgerEntries();
    const earliest = all.map((e) => e.startDate).sort()[0];
    const result = searchStaticLedger({ ...DEFAULT_QUERY, from: "1900-01-01", to: earliest });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.entries.every((e) => e.startDate <= earliest)).toBe(true);
  });

  it("施工中を着工前より先に並べる", () => {
    const result = searchStaticLedger({ ...DEFAULT_QUERY, limit: 200 });
    const statuses = result.entries.map((e) => e.status);
    const firstPlanned = statuses.indexOf("planned");
    const lastActive = statuses.lastIndexOf("under_construction");
    if (firstPlanned >= 0 && lastActive >= 0) expect(lastActive).toBeLessThan(firstPlanned);
  });

  it("該当なしは 0 件を返す", () => {
    const result = searchStaticLedger({ ...DEFAULT_QUERY, keyword: "存在しない工事名XYZ" });
    expect(result.total).toBe(0);
    expect(result.entries).toHaveLength(0);
  });

  it("ファセットを返す", () => {
    const facets = staticLedgerFacets();
    expect(facets.categories.length).toBeGreaterThan(0);
    expect(facets.municipalities.length).toBeGreaterThan(0);
    expect(facets.workTypes.every((w) => w.length > 0)).toBe(true);
  });
});

describe("GET /api/ledger", () => {
  it("PostGIS 未構成でも 200 と静的データを返す", async () => {
    const response = await ledgerRoute.GET(new Request("http://localhost/api/ledger"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      count: number;
      total: number;
      source: string;
      sourceLabel: string;
      notice?: string;
      note: string;
      entries: unknown[];
      facets: { categories: string[] };
    };
    expect(body.source).toBe("static");
    expect(body.total).toBeGreaterThan(0);
    expect(body.count).toBe(body.entries.length);
    expect(body.notice).toBeTruthy();
    expect(body.note).toContain("補完値");
    expect(body.facets.categories.length).toBeGreaterThan(0);
  });

  it("不正な status は 400", async () => {
    const response = await ledgerRoute.GET(
      new Request("http://localhost/api/ledger?status=unknown"),
    );
    expect(response.status).toBe(400);
  });
});

describe("GET /api/geo/nearby", () => {
  it("住所座標の周辺現場を距離順に返す", async () => {
    const response = await nearbyRoute.GET(
      new Request(
        `http://localhost/api/geo/nearby?lng=${PLAZA.longitude}&lat=${PLAZA.latitude}&radius=500`,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      count: number;
      source: string;
      projects: { projectId: string; distanceM: number; insideWorkZone: boolean }[];
    };
    expect(body.source).toBe("static");
    expect(body.count).toBeGreaterThan(0);
    expect(body.projects[0].projectId).toBe("tokyo-demo-002");
    expect(body.projects[0].insideWorkZone).toBe(true);
    // 距離順
    const distances = body.projects.map((p) => p.distanceM);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it("経緯度が不正なら 400", async () => {
    const response = await nearbyRoute.GET(
      new Request("http://localhost/api/geo/nearby?lng=999&lat=0"),
    );
    expect(response.status).toBe(400);
  });
});

describe("GET /api/geo/contains", () => {
  it("工区の内側の点で工区を返す", async () => {
    const response = await containsRoute.GET(
      new Request(
        `http://localhost/api/geo/contains?lng=${PLAZA.longitude}&lat=${PLAZA.latitude}`,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      count: number;
      features: { projectId: string; featureKind: string }[];
    };
    expect(body.count).toBeGreaterThan(0);
    expect(body.features.some((f) => f.featureKind === "workzone")).toBe(true);
  });

  it("kinds で絞り込める", async () => {
    const response = await containsRoute.GET(
      new Request(
        `http://localhost/api/geo/contains?lng=${PLAZA.longitude}&lat=${PLAZA.latitude}&kinds=workzone`,
      ),
    );
    const body = (await response.json()) as { features: { featureKind: string }[] };
    expect(body.features.every((f) => f.featureKind === "workzone")).toBe(true);
  });

  it("遠くの点では 0 件", async () => {
    const response = await containsRoute.GET(
      new Request("http://localhost/api/geo/contains?lng=135.5&lat=34.7"),
    );
    const body = (await response.json()) as { count: number };
    expect(body.count).toBe(0);
  });
});

describe("GET /api/health", () => {
  it("DB 未構成でも degraded として構成状態を返す", async () => {
    const response = await healthRoute.GET(new Request("http://localhost/api/health"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      degraded: string[];
      database: { configured: boolean; reachable: boolean };
      viewer: { cesiumIonTokenConfigured: boolean; plateauTilesetConfigured: boolean };
      data: { projects: number; geoJsonFeatures: number };
    };
    expect(body.database.configured).toBe(false);
    expect(body.degraded).toContain("database");
    expect(body.data.projects).toBeGreaterThan(0);
    expect(body.data.geoJsonFeatures).toBeGreaterThan(0);
    // ion トークンは任意。未設定でもトークン不要の背景で動作する。
    expect(typeof body.viewer.cesiumIonTokenConfigured).toBe("boolean");
  });
});
