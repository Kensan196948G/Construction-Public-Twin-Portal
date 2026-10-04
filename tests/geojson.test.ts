/**
 * GeoJSON Test — `public/data/geo/**` の実ファイルを検証する（apidata 担当）。
 *
 * AC-007 の実証: クライアントが fetch する実ファイルが、
 * `featureCollectionSchema` を満たし、Polygon / LineString を含むこと。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { featureCollectionSchema, type FeatureCollection } from "@/lib/geo/geojson";
import { publicProjects } from "@/lib/data/projects";

const GEO_ROOT = fileURLToPath(new URL("../public/data/geo/", import.meta.url));

function readCollection(...segments: string[]): FeatureCollection {
  const raw = readFileSync(join(GEO_ROOT, ...segments), "utf8");
  const parsed = featureCollectionSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `${segments.join("/")} が GeoJSON として不正です: ` +
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" / "),
    );
  }
  return parsed.data;
}

function geometryTypes(collection: FeatureCollection): string[] {
  return collection.features.map((f) => f.geometry.type);
}

describe("public/data/geo/all の実ファイル", () => {
  const expectedKinds = ["workzone", "regulation", "detour", "pedestrian", "centers"] as const;

  it("5 種すべてが featureCollectionSchema を満たす", () => {
    for (const kind of expectedKinds) {
      const collection = readCollection("all", `${kind}.geojson`);
      expect(collection.type, kind).toBe("FeatureCollection");
      expect(collection.features.length, `${kind} は 1 件以上`).toBeGreaterThan(0);
    }
  });

  it("工区は Polygon、規制・迂回路・歩道切替は LineString、中心は Point を含む", () => {
    expect(geometryTypes(readCollection("all", "workzone.geojson"))).toContain("Polygon");
    expect(geometryTypes(readCollection("all", "regulation.geojson"))).toContain("LineString");
    expect(geometryTypes(readCollection("all", "detour.geojson"))).toContain("LineString");
    expect(geometryTypes(readCollection("all", "pedestrian.geojson"))).toContain("LineString");
    expect(geometryTypes(readCollection("all", "centers.geojson"))).toContain("Point");
  });

  it("工区 Feature は公開案件と 1 対 1 で対応する", () => {
    const workzone = readCollection("all", "workzone.geojson");
    const publicIds = new Set(publicProjects().map((p) => p.id));
    expect(workzone.features.length).toBe(publicIds.size);
    for (const feature of workzone.features) {
      expect(publicIds.has(feature.properties.projectId)).toBe(true);
    }
  });

  it("全 Feature が必須 properties（id/projectId/type/name）を持つ", () => {
    for (const kind of expectedKinds) {
      for (const feature of readCollection("all", `${kind}.geojson`).features) {
        expect(feature.properties.id.length, kind).toBeGreaterThan(0);
        expect(feature.properties.projectId.length, kind).toBeGreaterThan(0);
        expect(feature.properties.type.length, kind).toBeGreaterThan(0);
        expect(feature.properties.name.length, kind).toBeGreaterThan(0);
      }
    }
  });
});

describe("案件別ディレクトリの実ファイル", () => {
  const slugs = readdirSync(GEO_ROOT).filter((name) =>
    statSync(join(GEO_ROOT, name)).isDirectory(),
  );
  const projectSlugs = slugs.filter((slug) => slug !== "all");

  it("案件別ディレクトリが存在する", () => {
    expect(projectSlugs.length).toBeGreaterThan(0);
    expect(projectSlugs.length).toBe(publicProjects().length);
  });

  it("各案件の workzone / regulation / detour / pedestrian がすべて検証を通る", () => {
    let checked = 0;
    for (const slug of projectSlugs) {
      for (const kind of ["workzone", "regulation", "detour", "pedestrian"] as const) {
        const collection = readCollection(slug, `${kind}.geojson`);
        // ジオメトリを持たない案件は features: [] を許容する（スキーマ上も有効）
        for (const feature of collection.features) {
          expect(feature.properties.projectId, `${slug}/${kind}`).toBeTruthy();
        }
        checked += 1;
      }
    }
    expect(checked).toBe(projectSlugs.length * 4);
  });
});
