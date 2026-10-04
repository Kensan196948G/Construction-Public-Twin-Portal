/**
 * PostGIS への問い合わせ（サーバー専用）。
 *
 * ここに SQL を集約し、API ルートは「PostGIS が使えれば使う／使えなければ
 * 静的データへフォールバックする」だけを判断する。
 *
 * 公開状態の扱い:
 *   `published` かつ `public` 以外は絶対に返さない（仕様書 #14 / REQ-S-004）。
 *   SQL 側でも WHERE 句で担保する。
 */
import { query, type DbOutcome } from "@/lib/db/client";
import type { SiteLedgerEntry } from "@/lib/schemas/ledger";

/* ------------------------------------------------------------------ *
 * 現場台帳検索
 * ------------------------------------------------------------------ */

export interface LedgerQuery {
  keyword?: string;
  category?: string;
  status?: string;
  municipality?: string;
  owner?: string;
  contractor?: string;
  workType?: string;
  /** JV 案件のみ */
  jvOnly?: boolean;
  /** 着工日の範囲（YYYY-MM-DD） */
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

/** 台帳1行の SELECT 句（nearby 等でも同じ並びを使う） */
const LEDGER_COLUMNS = `
  p.project_id,
  p.slug,
  p.order_no,
  p.official_name,
  p.public_title,
  p.category,
  p.work_type,
  p.site_type,
  p.owner_name,
  p.contractor_name,
  p.jv_name,
  p.status,
  to_char(p.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(p.planned_end_date, 'YYYY-MM-DD') AS planned_end_date,
  p.phase,
  to_char(p.last_updated_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI:SS+09:00') AS last_updated_at,
  p.prefecture,
  p.city,
  p.ward,
  p.town,
  p.address,
  p.municipality,
  ST_X(p.center) AS longitude,
  ST_Y(p.center) AS latitude,
  p.classification,
  p.publication_state,
  p.official_url,
  p.source_provider,
  p.ledger_is_sample
`;

interface LedgerRow {
  project_id: string;
  slug: string;
  order_no: string;
  official_name: string;
  public_title: string;
  category: string;
  work_type: string | null;
  site_type: string;
  owner_name: string;
  contractor_name: string;
  jv_name: string | null;
  status: string;
  start_date: string;
  planned_end_date: string;
  phase: string;
  last_updated_at: string;
  prefecture: string;
  city: string;
  ward: string;
  town: string;
  address: string;
  municipality: string;
  longitude: number;
  latitude: number;
  classification: string;
  publication_state: string;
  official_url: string;
  source_provider: string;
  ledger_is_sample: boolean;
  total_count?: string;
}

export function rowToLedger(row: LedgerRow): SiteLedgerEntry {
  return {
    projectId: row.project_id,
    slug: row.slug,
    orderNo: row.order_no,
    officialName: row.official_name,
    publicTitle: row.public_title,
    category: row.category,
    workType: row.work_type ?? "未設定",
    siteType: row.site_type,
    ownerName: row.owner_name,
    contractorName: row.contractor_name,
    jvName: row.jv_name,
    status: row.status,
    startDate: row.start_date,
    plannedEndDate: row.planned_end_date,
    phase: row.phase,
    lastUpdatedAt: row.last_updated_at,
    prefecture: row.prefecture,
    city: row.city,
    ward: row.ward,
    town: row.town,
    address: row.address,
    municipality: row.municipality,
    center: { longitude: Number(row.longitude), latitude: Number(row.latitude) },
    classification: row.classification,
    publicationState: row.publication_state,
    officialUrl: row.official_url,
    sourceProvider: row.source_provider,
    isSample: Boolean(row.ledger_is_sample),
  };
}

export interface LedgerQueryResult {
  entries: SiteLedgerEntry[];
  total: number;
}

export async function queryLedger(
  input: LedgerQuery,
): Promise<DbOutcome<LedgerQueryResult>> {
  const conditions: string[] = [
    "p.publication_state = 'published'",
    "p.classification = 'public'",
  ];
  const values: unknown[] = [];

  const push = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (input.keyword) {
    const pattern = `%${input.keyword}%`;
    const p = push(pattern);
    // 工事件名・住所・発注者・元請・JV・発注番号・現場ID・工種を対象にした AND 検索
    conditions.push(`(
      p.official_name ILIKE ${p}
      OR p.public_title ILIKE ${p}
      OR p.address ILIKE ${p}
      OR p.municipality ILIKE ${p}
      OR p.owner_name ILIKE ${p}
      OR p.contractor_name ILIKE ${p}
      OR COALESCE(p.jv_name, '') ILIKE ${p}
      OR p.order_no ILIKE ${p}
      OR p.project_id ILIKE ${p}
      OR COALESCE(p.work_type, '') ILIKE ${p}
    )`);
  }
  if (input.category) conditions.push(`p.category = ${push(input.category)}`);
  if (input.status) conditions.push(`p.status = ${push(input.status)}`);
  if (input.municipality) conditions.push(`p.municipality = ${push(input.municipality)}`);
  if (input.owner) conditions.push(`p.owner_name ILIKE ${push(`%${input.owner}%`)}`);
  if (input.contractor) conditions.push(`p.contractor_name ILIKE ${push(`%${input.contractor}%`)}`);
  if (input.workType) conditions.push(`COALESCE(p.work_type, '') ILIKE ${push(`%${input.workType}%`)}`);
  if (input.jvOnly) conditions.push("p.jv_name IS NOT NULL");
  if (input.from) conditions.push(`p.start_date >= ${push(input.from)}::date`);
  if (input.to) conditions.push(`p.start_date <= ${push(input.to)}::date`);

  const limit = push(input.limit);
  const offset = push(input.offset);

  const sql = `
    SELECT ${LEDGER_COLUMNS}, count(*) OVER () AS total_count
      FROM twin.construction_projects p
     WHERE ${conditions.join("\n       AND ")}
     ORDER BY
       CASE p.status
         WHEN 'under_construction' THEN 0
         WHEN 'planned' THEN 1
         WHEN 'completed' THEN 2
         ELSE 3
       END,
       p.start_date DESC,
       p.project_id
     LIMIT ${limit} OFFSET ${offset}
  `;

  const result = await query<LedgerRow>(sql, values);
  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      entries: result.data.map(rowToLedger),
      total: result.data.length > 0 ? Number(result.data[0].total_count ?? result.data.length) : 0,
    },
  };
}

/** 台帳の選択肢（フィルタ UI 用） */
export interface LedgerFacets {
  categories: string[];
  statuses: string[];
  municipalities: string[];
  owners: string[];
  contractors: string[];
  workTypes: string[];
}

export async function queryLedgerFacets(): Promise<DbOutcome<LedgerFacets>> {
  const result = await query<{
    categories: string[];
    statuses: string[];
    municipalities: string[];
    owners: string[];
    contractors: string[];
    work_types: string[];
  }>(`
    SELECT
      array_agg(DISTINCT category ORDER BY category) AS categories,
      array_agg(DISTINCT status ORDER BY status) AS statuses,
      array_agg(DISTINCT municipality ORDER BY municipality) AS municipalities,
      array_agg(DISTINCT owner_name ORDER BY owner_name) AS owners,
      array_agg(DISTINCT contractor_name ORDER BY contractor_name) AS contractors,
      array_agg(DISTINCT COALESCE(work_type, '未設定') ORDER BY COALESCE(work_type, '未設定')) AS work_types
    FROM twin.construction_projects
    WHERE publication_state = 'published' AND classification = 'public'
  `);
  if (!result.ok) return result;
  const row = result.data[0];
  return {
    ok: true,
    data: {
      categories: row?.categories ?? [],
      statuses: row?.statuses ?? [],
      municipalities: row?.municipalities ?? [],
      owners: row?.owners ?? [],
      contractors: row?.contractors ?? [],
      workTypes: row?.work_types ?? [],
    },
  };
}

/* ------------------------------------------------------------------ *
 * 空間検索
 * ------------------------------------------------------------------ */

export interface NearbyRow {
  project_id: string;
  official_name: string;
  public_title: string;
  category: string;
  status: string;
  municipality: string;
  address: string;
  distance_m: number;
  inside_work_zone: boolean;
}

export async function queryNearby(
  longitude: number,
  latitude: number,
  radiusM: number,
  limit: number,
): Promise<DbOutcome<NearbyRow[]>> {
  return query<NearbyRow>(
    `SELECT * FROM twin.nearby_projects($1::double precision, $2::double precision, $3::double precision, $4::integer)`,
    [longitude, latitude, radiusM, limit],
  );
}

export interface ContainingRow {
  feature_id: string;
  project_id: string;
  feature_kind: string;
  name: string;
  geometry_type: string;
  distance_m: number;
}

export async function queryContaining(
  longitude: number,
  latitude: number,
  kinds: string[] | null,
  limit: number,
): Promise<DbOutcome<ContainingRow[]>> {
  return query<ContainingRow>(
    `SELECT * FROM twin.features_containing($1::double precision, $2::double precision, $3::text[], $4::integer)`,
    [longitude, latitude, kinds, limit],
  );
}

export interface ActiveImpactRow {
  impact_id: string;
  project_id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  active_from: string | null;
  active_to: string | null;
  recurrence: string | null;
}

export async function queryImpactsActiveAt(
  at: string,
  projectId: string | null,
): Promise<DbOutcome<ActiveImpactRow[]>> {
  return query<ActiveImpactRow>(
    `SELECT * FROM twin.impacts_active_at($1::date, $2::text)`,
    [at, projectId],
  );
}

/* ------------------------------------------------------------------ *
 * 出典・来歴（REQ-D-007 / REQ-F-009）
 * ------------------------------------------------------------------ */

export interface ProvenanceRow {
  dataset: string;
  provider: string;
  area: string | null;
  license: string | null;
  url: string | null;
  note: string | null;
}

export async function queryProvenance(): Promise<DbOutcome<ProvenanceRow[]>> {
  return query<ProvenanceRow>(`
    SELECT dataset, provider, area, license, url, note
      FROM twin.data_provenance
     ORDER BY dataset
  `);
}
