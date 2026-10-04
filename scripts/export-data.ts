/**
 * 静的データの書き出し。
 *
 * lib/data の検証済みデータセットから public/data 配下へ
 * JSON / GeoJSON を生成する。クライアントはこれを fetch() で読み込む。
 *
 *   npm run export:data
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { exportTargets } from "../lib/data/geometry";
import { publicProjects, toSummary } from "../lib/data/projects";
import { publicImpacts } from "../lib/data/impacts";
import { categoryCounts, statusCounts, municipalities } from "../lib/data/projects";

const PUBLIC_DIR = join(process.cwd(), "public");

async function writeJson(relativePath: string, value: unknown): Promise<void> {
  const full = join(PUBLIC_DIR, relativePath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const projects = publicProjects();
  const impacts = publicImpacts();

  // 1. GeoJSON
  const targets = exportTargets();
  for (const target of targets) {
    await writeJson(target.path, target.collection);
  }

  // 2. 工事一覧（サマリ）
  await writeJson("data/projects/index.json", {
    generatedAt: new Date().toISOString(),
    count: projects.length,
    facets: {
      categories: categoryCounts(projects),
      statuses: statusCounts(projects),
      municipalities: municipalities(projects),
    },
    projects: projects.map(toSummary),
  });

  // 3. 工事詳細
  for (const project of projects) {
    await writeJson(`data/projects/${project.slug}.json`, project);
  }

  // 4. 影響イベント
  await writeJson("data/impacts/index.json", {
    generatedAt: new Date().toISOString(),
    count: impacts.length,
    impacts,
  });

  const featureCount = targets.reduce((sum, t) => sum + t.collection.features.length, 0);
  console.log(
    `[export:data] projects=${projects.length} impacts=${impacts.length} ` +
      `geojsonFiles=${targets.length} features=${featureCount}`,
  );
}

main().catch((error: unknown) => {
  console.error("[export:data] 失敗:", error);
  process.exit(1);
});
