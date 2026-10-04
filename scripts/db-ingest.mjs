#!/usr/bin/env node
/**
 * 工事データ（public/data/**）を PostGIS へ投入する。
 *
 *   node scripts/db-ingest.mjs                 # SQL を db/seed.sql へ書き出す
 *   node scripts/db-ingest.mjs --apply         # DATABASE_URL へ直接適用する
 *   node scripts/db-ingest.mjs --out path.sql  # 出力先を指定する
 *
 * 入力は「生成済みの公開データ」のみを使う（lib/ の TS には依存しない）。
 *   public/data/projects/*.json    工事台帳
 *   public/data/impacts/index.json 影響イベント
 *   public/data/geo/<slug>/*.geojson 施工範囲・規制・迂回路・歩道切替
 *
 * 設計上の約束:
 *   - 実在しない台帳項目（発注番号・JV・工種細分類）は **決定的に生成** し、
 *     construction_projects.ledger_is_sample = true として明示する。
 *     実データが接続されたら db-ingest の該当箇所を差し替えるだけでよい。
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(PROJECT_DIR, "public");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const outIndex = args.indexOf("--out");
const OUT_FILE = outIndex >= 0 ? args[outIndex + 1] : join(PROJECT_DIR, "db", "seed.sql");

/* ------------------------------------------------------------------ *
 * SQL リテラル生成
 * ------------------------------------------------------------------ */

/** 文字列リテラル。null / undefined / 空文字は NULL。 */
function q(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * 空文字を「空文字」として保持する文字列リテラル。
 * NOT NULL かつ「該当なしは空文字」という列（政令市の city / 23区の ward など）に使う。
 */
function qText(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** 必須文字列（空なら例外） */
function qRequired(value, label) {
  if (value === null || value === undefined || String(value).length === 0) {
    throw new Error(`必須項目が空です: ${label}`);
  }
  return q(value);
}

/** text[] リテラル */
function qArray(values) {
  if (!Array.isArray(values) || values.length === 0) return `'{}'::text[]`;
  return `ARRAY[${values.map((v) => q(v)).join(", ")}]::text[]`;
}

/** jsonb リテラル */
function qJson(value) {
  if (value === null || value === undefined) return `'{}'::jsonb`;
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
}

/** date リテラル（YYYY-MM-DD 以外は NULL） */
function qDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "NULL";
  return `${q(value)}::date`;
}

/** timestamptz リテラル */
function qTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "now()";
  return `${q(value)}::timestamptz`;
}

/* ------------------------------------------------------------------ *
 * 台帳項目の決定的生成（サンプル補完）
 * ------------------------------------------------------------------ */

const WORK_TYPE_BY_CATEGORY = {
  道路: "道路改良・舗装",
  広場: "広場・歩行者空間整備",
  下水道: "下水道管路更生",
  公園: "公園・緑地整備",
  "建築・都市部": "建築主体工事",
  "建築・地方": "建築主体工事",
  "土木・都市部": "土木構造物工事",
  "土木・地方": "土木構造物工事",
};

/** 現場ID から決定的に 5 桁の連番を作る（実データ接続までの暫定） */
function sequenceFromId(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.codePointAt(0)) % 100000;
  return String(hash).padStart(5, "0");
}

/** 発注番号: PRJ-<着工年>-<連番> */
function orderNoOf(project) {
  const year = (project.schedule?.startDate ?? "2026-01-01").slice(0, 4);
  return `PRJ-${year}-${sequenceFromId(project.id)}`;
}

/** JV: 建築系のみ共同企業体として扱う（決定規則） */
function jvNameOf(project) {
  if (!project.category.startsWith("建築")) return null;
  return `${project.contractor.name} 建設共同企業体`;
}

/** 住所の正規化（全角英数→半角、空白除去） */
function normalizeAddress(address) {
  if (typeof address !== "string") return null;
  return address
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "")
    .trim();
}

/* ------------------------------------------------------------------ *
 * 入力の読み込み
 * ------------------------------------------------------------------ */

async function loadProjects() {
  const dir = join(PUBLIC_DIR, "data", "projects");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json") && f !== "index.json");
  const projects = [];
  for (const file of files.sort()) {
    projects.push(JSON.parse(await readFile(join(dir, file), "utf8")));
  }
  return projects;
}

async function loadImpacts() {
  const file = join(PUBLIC_DIR, "data", "impacts", "index.json");
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(await readFile(file, "utf8"));
  return Array.isArray(parsed.impacts) ? parsed.impacts : [];
}

/** 施工範囲 GeoJSON（案件ごと・種類ごと） */
async function loadFeatureCollections(projects) {
  const geoDir = join(PUBLIC_DIR, "data", "geo");
  const out = [];
  for (const project of projects) {
    const dir = join(geoDir, project.slug);
    if (!existsSync(dir)) continue;
    for (const file of (await readdir(dir)).sort()) {
      if (!file.endsWith(".geojson")) continue;
      const kind = file.replace(/\.geojson$/, "");
      const collection = JSON.parse(await readFile(join(dir, file), "utf8"));
      for (const feature of collection.features ?? []) {
        out.push({ project, kind, feature });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * SQL 構築
 * ------------------------------------------------------------------ */

function buildSql({ projects, impacts, features }) {
  const lines = [];
  const push = (s) => lines.push(s);

  push("-- 自動生成: scripts/db-ingest.mjs — 手で編集しないこと。");
  push(`-- 生成日時: ${new Date().toISOString()}`);
  push(`-- 案件: ${projects.length} / 影響イベント: ${impacts.length} / 地物: ${features.length}`);
  push("");
  push("BEGIN;");
  push("");
  // TRUNCATE は TRUNCATE 権限を要するため、アプリロールでも実行できる DELETE を使う。
  // 子テーブルから順に消す（外部キー制約）。
  push("DELETE FROM twin.audit_log;");
  push("DELETE FROM twin.source_registry;");
  push("DELETE FROM twin.data_provenance;");
  push("DELETE FROM twin.impact_events;");
  push("DELETE FROM twin.construction_features;");
  push("DELETE FROM twin.construction_projects;");
  push("DELETE FROM twin.organizations;");
  push("");

  /* --- 組織 --- */
  const orgs = new Map();
  for (const p of projects) {
    orgs.set(`owner:${p.owner.name}`, { id: `org-owner-${slugify(p.owner.name)}`, name: p.owner.name, role: "owner" });
    orgs.set(`contractor:${p.contractor.name}`, {
      id: `org-contractor-${slugify(p.contractor.name)}`,
      name: p.contractor.name,
      role: "contractor",
    });
    const jv = jvNameOf(p);
    if (jv) orgs.set(`jv:${jv}`, { id: `org-jv-${slugify(jv)}`, name: jv, role: "jv" });
  }
  push("-- 1. 組織");
  for (const org of [...orgs.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    push(
      `INSERT INTO twin.organizations (organization_id, name, role) VALUES (${q(org.id)}, ${q(org.name)}, ${q(org.role)}) ON CONFLICT (organization_id) DO NOTHING;`,
    );
  }
  push("");

  /* --- 工事台帳 --- */
  push("-- 2. 工事（現場台帳）");
  const columns = [
    "project_id", "slug", "order_no", "category", "work_type", "site_type",
    "official_name", "public_title", "purpose", "benefits",
    "owner_name", "contractor_name", "jv_name",
    "status", "start_date", "planned_end_date", "phase", "last_updated_at",
    "postal_code", "prefecture", "city", "ward", "town", "address", "municipality", "normalized_address",
    "center",
    "classification", "publication_state", "review_due_at",
    "official_url", "source_provider", "source_dataset", "source_license", "verified_at", "disclaimer",
    "ledger_is_sample",
  ];
  for (const p of projects) {
    const center = `ST_SetSRID(ST_MakePoint(${Number(p.location.center.longitude)}, ${Number(p.location.center.latitude)}), 4326)::geometry(Point,4326)`;
    const values = [
      qRequired(p.id, `${p.slug}.id`),
      qRequired(p.slug, `${p.slug}.slug`),
      q(orderNoOf(p)),
      qRequired(p.category, `${p.slug}.category`),
      q(WORK_TYPE_BY_CATEGORY[p.category] ?? null),
      qRequired(p.siteType, `${p.slug}.siteType`),
      qRequired(p.name, `${p.slug}.name`),
      qRequired(p.publicTitle, `${p.slug}.publicTitle`),
      qRequired(p.purpose, `${p.slug}.purpose`),
      qArray(p.benefits),
      qRequired(p.owner.name, `${p.slug}.owner`),
      qRequired(p.contractor.name, `${p.slug}.contractor`),
      q(jvNameOf(p)),
      qRequired(p.status, `${p.slug}.status`),
      qDate(p.schedule.startDate),
      qDate(p.schedule.plannedEndDate),
      qRequired(p.schedule.phase, `${p.slug}.phase`),
      qTimestamp(p.schedule.lastUpdatedAt),
      q(p.location.postalCode ?? null),
      qRequired(p.location.prefecture, `${p.slug}.prefecture`),
      qText(p.location.city ?? ""),
      qText(p.location.ward ?? ""),
      qRequired(p.location.town, `${p.slug}.town`),
      qRequired(p.location.address, `${p.slug}.address`),
      qRequired(p.location.municipality, `${p.slug}.municipality`),
      q(normalizeAddress(p.location.address)),
      center,
      qRequired(p.visibility.classification, `${p.slug}.classification`),
      qRequired(p.visibility.publicationState, `${p.slug}.publicationState`),
      qDate(p.visibility.reviewDueAt ?? null),
      qRequired(p.source.officialUrl, `${p.slug}.officialUrl`),
      qRequired(p.source.provider, `${p.slug}.source.provider`),
      q(p.source.dataset ?? null),
      q(p.source.license ?? null),
      qTimestamp(p.source.verifiedAt),
      qRequired(p.disclaimer, `${p.slug}.disclaimer`),
      "true",
    ];
    push(
      `INSERT INTO twin.construction_projects (${columns.join(", ")}) VALUES (${values.join(", ")});`,
    );
  }
  push("");

  /* --- 施工範囲（地物） --- */
  push("-- 3. 施工範囲・規制・迂回路（GeoJSON → geometry）");
  const kindCheck = new Set(["workzone", "regulation", "detour", "pedestrian"]);
  for (const { project, kind, feature } of features) {
    const props = feature.properties ?? {};
    const featureId = props.id ?? `${project.id}:${kind}`;
    const featureKind = props.type && kindCheck.has(props.type) ? props.type : kind;
    const name = props.name ?? `${project.publicTitle} ${featureKind}`;
    const geometryJson = JSON.stringify(feature.geometry);
    push(
      `INSERT INTO twin.construction_features ` +
        `(feature_id, project_id, feature_kind, name, geometry, geometry_type, valid_from, valid_to, source_provider, updated_at, public_geometry, public_precision_m, properties) VALUES (` +
        [
          qRequired(featureId, "feature.id"),
          qRequired(project.id, "feature.projectId"),
          qRequired(featureKind, "feature.kind"),
          qRequired(name, "feature.name"),
          `ST_SetSRID(ST_GeomFromGeoJSON(${q(geometryJson)}), 4326)`,
          qRequired(feature.geometry?.type ?? "Geometry", "feature.geometry.type"),
          qDate(props.validFrom ?? null),
          qDate(props.validTo ?? null),
          q(props.source?.provider ?? props.source ?? project.source.provider),
          qTimestamp(props.updatedAt ?? project.schedule.lastUpdatedAt),
          "true",
          "NULL",
          qJson({ projectSlug: project.slug, sourceFile: `${kind}.geojson` }),
        ].join(", ") +
        `);`,
    );
  }
  push("");

  /* --- 工区の集約（代表ポリゴン） --- */
  push("-- 4. 工区の集約と面積");
  push("UPDATE twin.construction_projects p");
  push("   SET work_zone = sub.g, work_zone_area_m2 = ST_Area(sub.g::geography)");
  push("  FROM (");
  push("        SELECT project_id, ST_Multi(ST_Union(geometry))::geometry(MultiPolygon, 4326) AS g");
  push("          FROM twin.construction_features");
  push("         WHERE feature_kind = 'workzone'");
  push("         GROUP BY project_id");
  push("       ) sub");
  push(" WHERE p.project_id = sub.project_id;");
  push("");

  /* --- 影響イベント --- */
  push("-- 5. 影響イベント");
  for (const impact of impacts) {
    push(
      `INSERT INTO twin.impact_events ` +
        `(impact_id, project_id, type, severity, title, description, active_from, active_to, recurrence, geometry_kind, source_provider, official_url, verified_at) VALUES (` +
        [
          qRequired(impact.id, "impact.id"),
          qRequired(impact.projectId, "impact.projectId"),
          qRequired(impact.type, "impact.type"),
          qRequired(impact.severity, "impact.severity"),
          qRequired(impact.title, "impact.title"),
          qText(impact.description ?? ""),
          qDate(impact.activeFrom ?? null),
          qDate(impact.activeTo ?? null),
          q(impact.recurrence ?? null),
          q(impact.geometryKind ?? null),
          q(impact.source?.provider ?? null),
          q(impact.source?.officialUrl ?? null),
          qTimestamp(impact.source?.verifiedAt ?? null),
        ].join(", ") +
        `);`,
    );
  }
  push("");
  push("-- 5b. 影響イベントへ地物ジオメトリを紐付け");
  push("UPDATE twin.impact_events i");
  push("   SET geometry = f.geometry");
  push("  FROM twin.construction_features f");
  push(" WHERE f.project_id = i.project_id");
  push("   AND i.geometry_kind IS NOT NULL");
  push("   AND f.feature_kind = i.geometry_kind;");
  push("");

  /* --- データ来歴（REQ-D-007） --- */
  push("-- 6. 外部データの来歴・ライセンス台帳");
  const provenance = [
    {
      dataset: "PLATEAU 3D都市モデル（3D Tiles）",
      provider: "国土交通省 Project PLATEAU",
      area: "東京都 大田区 田園調布周辺",
      fiscalYear: "2023",
      license: "CC BY 4.0",
      url: "https://www.geospatial.jp/ckan/dataset/plateau",
      note: "背景3D都市モデル。環境変数 NEXT_PUBLIC_PLATEAU_TILESET_URL で供給。",
    },
    {
      dataset: "Japan 3D Buildings（ion asset 2602291）",
      provider: "Cesium GS, Inc.（PLATEAU を加工）",
      area: "日本全国",
      fiscalYear: "2024",
      license: "Cesium ion 利用規約 / 出典: 3D都市モデル（国土交通省）を加工して作成",
      url: "https://cesium.com/platform/cesium-ion/content/japan-3d-buildings/",
      note: "CesiumJS ビューアの主題3D建物。ion アクセストークンが必要。",
    },
    {
      dataset: "Japan Regional Terrain（ion asset 2767062）",
      provider: "Cesium GS, Inc.（国土地理院 基盤地図情報を加工）",
      area: "日本全国",
      fiscalYear: "2024",
      license: "Cesium ion 利用規約",
      url: "https://cesium.com/platform/cesium-ion/content/japan-3d-buildings/",
      note: "日本の地形タイル。ion アクセストークンが必要。",
    },
    {
      dataset: "地理院タイル（標準地図・空中写真）",
      provider: "国土地理院",
      area: "日本全国",
      fiscalYear: "2026",
      license: "地理院タイル利用規約（出典表示）",
      url: "https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html",
      note: "2D地図・地形の背景。出典「国土地理院」の表示が必要。",
    },
    {
      dataset: "国土地理院 住所検索API",
      provider: "国土地理院",
      area: "日本全国",
      fiscalYear: "2026",
      license: "政府標準利用規約（出典表示）",
      url: "https://msearch.gsi.go.jp/address-search/AddressSearch",
      note: "公的ジオコーダー。住所文字列→緯度経度。API キー不要。",
    },
  ];
  for (const row of provenance) {
    push(
      `INSERT INTO twin.data_provenance (dataset, provider, area, fiscal_year, acquired_at, license, url, note) VALUES (` +
        [q(row.dataset), q(row.provider), q(row.area), q(row.fiscalYear), "CURRENT_DATE", q(row.license), q(row.url), q(row.note)].join(", ") +
        `) ON CONFLICT (dataset, provider, area) DO UPDATE SET license = EXCLUDED.license, url = EXCLUDED.url, note = EXCLUDED.note;`,
    );
  }
  push("");

  /* --- 出典レジストリ（REQ-F-009） --- */
  push("-- 7. 出典レジストリ");
  const sources = [
    {
      id: "gsi-address-search",
      label: "国土地理院 住所検索API",
      provider: "国土地理院",
      url: "https://msearch.gsi.go.jp/address-search/AddressSearch",
      license: "政府標準利用規約",
      attribution: "出典：国土地理院 住所検索API",
      kind: "geocoder",
    },
    {
      id: "gsi-tiles",
      label: "地理院タイル",
      provider: "国土地理院",
      url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
      license: "地理院タイル利用規約",
      attribution: "出典：国土地理院",
      kind: "imagery",
    },
    {
      id: "cesium-japan-buildings",
      label: "Cesium ion Japan 3D Buildings",
      provider: "Cesium GS, Inc.",
      url: "https://cesium.com/platform/cesium-ion/content/japan-3d-buildings/",
      license: "Cesium ion 利用規約",
      attribution: "3D都市モデル（国土交通省）を加工して作成",
      kind: "tileset",
    },
    {
      id: "plateau",
      label: "PLATEAU 3D都市モデル",
      provider: "国土交通省 Project PLATEAU",
      url: "https://www.geospatial.jp/ckan/dataset/plateau",
      license: "CC BY 4.0",
      attribution: "国土交通省 Project PLATEAU",
      kind: "tileset",
    },
    {
      id: "site-ledger",
      label: "自社現場台帳（PostGIS）",
      provider: "Construction Public Twin Portal",
      url: "http://192.168.0.185:43100/",
      license: "社内データ",
      attribution: "自社現場台帳",
      kind: "ledger",
    },
  ];
  for (const s of sources) {
    push(
      `INSERT INTO twin.source_registry (source_id, label, provider, official_url, license, attribution, source_kind) VALUES (` +
        [q(s.id), q(s.label), q(s.provider), q(s.url), q(s.license), q(s.attribution), q(s.kind)].join(", ") +
        `) ON CONFLICT (source_id) DO UPDATE SET label = EXCLUDED.label, license = EXCLUDED.license, attribution = EXCLUDED.attribution;`,
    );
  }
  push("");

  /* --- 監査ログ --- */
  push("-- 8. 監査ログ（投入記録）");
  push(
    `INSERT INTO twin.audit_log (actor, action, project_id, result, detail) VALUES (` +
      [
        q("scripts/db-ingest.mjs"),
        q("ingest"),
        "NULL",
        q("success"),
        qJson({ projects: projects.length, impacts: impacts.length, features: features.length }),
      ].join(", ") +
      `);`,
  );
  push("");
  push("COMMIT;");
  push("");

  return lines.join("\n");
}

function slugify(value) {
  return String(value)
    .replace(/[^0-9A-Za-zぁ-んァ-ヶ一-龠]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/* ------------------------------------------------------------------ *
 * 実行
 * ------------------------------------------------------------------ */

async function main() {
  const projects = await loadProjects();
  const impacts = await loadImpacts();
  const features = await loadFeatureCollections(projects);

  if (projects.length === 0) {
    throw new Error("工事データが 0 件です。先に `npm run export:data` を実行してください。");
  }

  const sql = buildSql({ projects, impacts, features });
  await writeFile(OUT_FILE, sql, "utf8");
  console.log(
    `[db-ingest] SQL を書き出しました: ${OUT_FILE} ` +
      `(projects=${projects.length} impacts=${impacts.length} features=${features.length})`,
  );

  if (APPLY) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("--apply には DATABASE_URL が必要です。");
    }
    // psql は DATABASE_URL を解釈しないため、接続情報を PG* 環境変数へ分解して渡す。
    const parsed = new URL(url);
    const env = {
      ...process.env,
      PGHOST: parsed.hostname,
      PGPORT: parsed.port || "5432",
      PGUSER: decodeURIComponent(parsed.username),
      PGPASSWORD: decodeURIComponent(parsed.password),
      PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
      PGSSLMODE: "disable",
    };
    const result = spawnSync(
      "psql",
      ["-v", "ON_ERROR_STOP=1", "-q", "--no-psqlrc", "-f", OUT_FILE],
      { env, stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`psql の適用に失敗しました (exit ${result.status})`);
    }
    console.log("[db-ingest] PostGIS へ適用しました。");
  }
}

main().catch((error) => {
  console.error("[db-ingest] 失敗:", error instanceof Error ? error.message : error);
  process.exit(1);
});
