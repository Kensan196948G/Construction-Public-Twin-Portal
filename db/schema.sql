-- ============================================================================
-- 工事みえるマップ 3D Beta / Construction Public Twin Portal
-- PostGIS スキーマ定義（MVP）
--
-- 目的:
--   要件定義書 §7 データ要件 / REQ-D-001〜REQ-D-007 を PostGIS 上で実現する。
--   住所検索（ジオコーダー）は「ナビゲーション」、施工範囲は「工事管理上の正解」
--   という役割分担を、テーブル構造としても分離する。
--
-- 適用:
--   sudo -u postgres psql -d construction_twin -f db/schema.sql
--   または scripts/db-setup.sh から実行する。
--
-- 冪等性:
--   何度実行しても安全（DROP → CREATE）。データは db-ingest で再投入する。
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 0. スキーマ名前空間
-- ---------------------------------------------------------------------------
-- public スキーマは他システムと共有するため、本ポータル専用の名前空間を使う。
CREATE SCHEMA IF NOT EXISTS twin;

COMMENT ON SCHEMA twin IS '工事みえるマップ 3D Beta — 工事台帳・施工範囲・影響イベント';

-- ---------------------------------------------------------------------------
-- 1. 組織（発注者・施工者・JV・設計者）  REQ-D-002
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS twin.audit_log CASCADE;
DROP TABLE IF EXISTS twin.data_provenance CASCADE;
DROP TABLE IF EXISTS twin.source_registry CASCADE;
DROP TABLE IF EXISTS twin.impact_events CASCADE;
DROP TABLE IF EXISTS twin.construction_features CASCADE;
DROP TABLE IF EXISTS twin.construction_projects CASCADE;
DROP TABLE IF EXISTS twin.organizations CASCADE;

CREATE TABLE twin.organizations (
  organization_id text PRIMARY KEY,
  name            text NOT NULL,
  -- owner=発注者 / contractor=元請 / jv=JV / designer=設計者 / manager=監督
  role            text NOT NULL CHECK (role IN ('owner', 'contractor', 'jv', 'designer', 'manager')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE twin.organizations IS '工事関係者。REQ-D-002 の主体情報';

-- ---------------------------------------------------------------------------
-- 2. 工事（現場台帳 / 工事台帳）  REQ-D-001〜REQ-D-003
-- ---------------------------------------------------------------------------
CREATE TABLE twin.construction_projects (
  -- 現場ID（一意な Project ID）REQ-D-001
  project_id          text PRIMARY KEY,
  slug                text NOT NULL UNIQUE,
  -- 発注番号（自社台帳の管理番号）
  order_no            text,
  -- 工種（大分類・小分類）
  category            text NOT NULL,
  work_type           text,
  site_type           text NOT NULL,

  -- 名称
  official_name       text NOT NULL,
  public_title        text NOT NULL,
  purpose             text NOT NULL,
  benefits            text[] NOT NULL DEFAULT '{}',

  -- 関係者
  owner_name          text NOT NULL,
  contractor_name     text NOT NULL,
  jv_name             text,

  -- 工期 REQ-D-003
  status              text NOT NULL CHECK (status IN ('planned', 'under_construction', 'completed', 'suspended')),
  start_date          date NOT NULL,
  planned_end_date    date NOT NULL,
  phase               text NOT NULL,
  last_updated_at     timestamptz NOT NULL,

  -- 住所（ジオコーダー結果とは別に、台帳上の正式住所を持つ）
  postal_code         text,
  prefecture          text NOT NULL,
  city                text NOT NULL,
  ward                text NOT NULL,
  town                text NOT NULL,
  address             text NOT NULL,
  municipality        text NOT NULL,
  normalized_address  text,

  -- 代表点と施工範囲
  center              geometry(Point, 4326) NOT NULL,
  work_zone           geometry(MultiPolygon, 4326),
  work_zone_area_m2   double precision,

  -- 公開管理 REQ-F-010 / REQ-S-001
  classification      text NOT NULL CHECK (classification IN ('public', 'limited', 'internal', 'private')),
  publication_state   text NOT NULL CHECK (publication_state IN ('draft', 'review', 'approved', 'published', 'suspended', 'expired')),
  review_due_at       date,

  -- 出典 REQ-F-009 / REQ-D-007
  official_url        text NOT NULL,
  source_provider     text NOT NULL,
  source_dataset      text,
  source_license      text,
  verified_at         timestamptz NOT NULL,
  disclaimer          text NOT NULL,

  -- 補完フラグ: true = 自社台帳の実データではなく MVP 用に決定的生成した値
  ledger_is_sample    boolean NOT NULL DEFAULT true,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT construction_projects_period_chk CHECK (planned_end_date >= start_date)
);

COMMENT ON TABLE twin.construction_projects IS '現場台帳。工事名・現場ID・発注者・元請・JV・工種・工期を検索対象とする';
COMMENT ON COLUMN twin.construction_projects.ledger_is_sample IS '発注番号・JV・工種など台帳項目を MVP 用に生成した場合は true';

-- 空間インデックス（近傍検索・包含判定の性能要件 REQ-NF-004）
CREATE INDEX construction_projects_center_gix ON twin.construction_projects USING GIST (center);
CREATE INDEX construction_projects_work_zone_gix ON twin.construction_projects USING GIST (work_zone);
CREATE INDEX construction_projects_state_idx ON twin.construction_projects (publication_state, classification);
CREATE INDEX construction_projects_category_idx ON twin.construction_projects (category);
CREATE INDEX construction_projects_start_idx ON twin.construction_projects (start_date, planned_end_date);
-- 台帳の全文検索（工事件名・住所・発注者・元請・JV）
CREATE INDEX construction_projects_official_name_trgm ON twin.construction_projects USING GIN (official_name gin_trgm_ops);
CREATE INDEX construction_projects_public_title_trgm ON twin.construction_projects USING GIN (public_title gin_trgm_ops);
CREATE INDEX construction_projects_address_trgm ON twin.construction_projects USING GIN (address gin_trgm_ops);
CREATE INDEX construction_projects_owner_trgm ON twin.construction_projects USING GIN (owner_name gin_trgm_ops);
CREATE INDEX construction_projects_contractor_trgm ON twin.construction_projects USING GIN (contractor_name gin_trgm_ops);
CREATE INDEX construction_projects_order_no_idx ON twin.construction_projects (order_no);

-- ---------------------------------------------------------------------------
-- 3. 施工範囲（工区・線形・面・点）  REQ-D-004 / REQ-F-002 / REQ-F-005
--
--    「住所検索結果」と「施工範囲」を分離して保持する。
--    1 プロジェクトに複数の地物（工区 / 規制 / 迂回路 / 歩道切替 / 搬入口）が属する。
-- ---------------------------------------------------------------------------
CREATE TABLE twin.construction_features (
  feature_id       text PRIMARY KEY,
  project_id       text NOT NULL REFERENCES twin.construction_projects (project_id) ON DELETE CASCADE,
  -- workzone | regulation | detour | pedestrian | entrance | haul_route | storage_yard
  feature_kind     text NOT NULL,
  name             text NOT NULL,
  geometry         geometry(Geometry, 4326) NOT NULL,
  geometry_type    text NOT NULL,
  -- 有効期間（時間軸表示 REQ-F-008 の判定に使う）
  valid_from       date,
  valid_to         date,
  source_provider  text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- 公開可否（REQ-S-002 原本と公開用の分離）
  public_geometry  boolean NOT NULL DEFAULT true,
  -- 公開時の丸め粒度(m)。null は丸めなし。
  public_precision_m integer,
  properties       jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE twin.construction_features IS '施工範囲・規制・迂回路などの地理空間地物（GeoJSON 相当）';

CREATE INDEX construction_features_geom_gix ON twin.construction_features USING GIST (geometry);
CREATE INDEX construction_features_project_idx ON twin.construction_features (project_id, feature_kind);

-- ---------------------------------------------------------------------------
-- 4. 影響イベント（交通規制等）  REQ-D-005 / REQ-F-006
--    工事台帳の自由記述ではなく「いつ・どこで・何が発生するか」を持つ独立エンティティ
-- ---------------------------------------------------------------------------
CREATE TABLE twin.impact_events (
  impact_id        text PRIMARY KEY,
  project_id       text NOT NULL REFERENCES twin.construction_projects (project_id) ON DELETE CASCADE,
  type             text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('info', 'notice', 'warning')),
  title            text NOT NULL,
  description      text NOT NULL,
  active_from      date,
  active_to        date,
  recurrence       text,
  geometry_kind    text,
  geometry         geometry(Geometry, 4326),
  source_provider  text,
  official_url     text,
  verified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX impact_events_project_idx ON twin.impact_events (project_id);
CREATE INDEX impact_events_active_idx ON twin.impact_events (active_from, active_to);
CREATE INDEX impact_events_geom_gix ON twin.impact_events USING GIST (geometry);

-- ---------------------------------------------------------------------------
-- 5. データ来歴  REQ-D-007
--    外部データ（PLATEAU / 地理院タイル / ジオコーダー）の出所とライセンスを記録
-- ---------------------------------------------------------------------------
CREATE TABLE twin.data_provenance (
  provenance_id  bigserial PRIMARY KEY,
  dataset        text NOT NULL,
  provider       text NOT NULL,
  area           text,
  fiscal_year    text,
  acquired_at    date,
  license        text,
  url            text,
  note           text,
  UNIQUE (dataset, provider, area)
);

COMMENT ON TABLE twin.data_provenance IS '外部データの来歴・ライセンス台帳（REQ-D-007）';

-- ---------------------------------------------------------------------------
-- 6. 出典レジストリ  REQ-F-009
-- ---------------------------------------------------------------------------
CREATE TABLE twin.source_registry (
  source_id      text PRIMARY KEY,
  label          text NOT NULL,
  provider       text NOT NULL,
  official_url   text,
  license        text,
  attribution    text,
  -- geocoder | tileset | ledger | imagery
  source_kind    text NOT NULL,
  verified_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 7. 監査ログ  REQ-F-012 / REQ-S-005
-- ---------------------------------------------------------------------------
CREATE TABLE twin.audit_log (
  audit_id     bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor        text NOT NULL,
  action       text NOT NULL CHECK (action IN (
                 'create', 'update', 'approve', 'publish', 'unpublish',
                 'suspend', 'delete', 'file_update', 'ingest', 'read_precise')),
  project_id   text,
  old_version  text,
  new_version  text,
  result       text NOT NULL,
  client_ip    inet,
  request_id   text,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX audit_log_occurred_idx ON twin.audit_log (occurred_at DESC);
CREATE INDEX audit_log_project_idx ON twin.audit_log (project_id, occurred_at DESC);

-- ============================================================================
-- 8. 公開ビュー（REQ-S-002 / REQ-S-004）
--    原本テーブルを直接公開せず、「公開承認済み」のみを返すビューを用意する。
--    施工範囲は公開精度に応じてメッシュ丸めしたジオメトリを返す。
-- ============================================================================

CREATE OR REPLACE VIEW twin.public_projects AS
SELECT
  p.project_id,
  p.slug,
  p.official_name,
  p.public_title,
  p.category,
  p.site_type,
  p.status,
  p.purpose,
  p.benefits,
  p.owner_name,
  p.contractor_name,
  p.municipality,
  p.address,
  p.start_date,
  p.planned_end_date,
  p.phase,
  p.last_updated_at,
  p.official_url,
  p.source_provider,
  p.disclaimer,
  -- 公開用の代表点は 250m メッシュ相当（0.0025 度 ≈ 250m）へ丸める
  ST_SnapToGrid(p.center, 0.0025)::geometry(Point, 4326) AS public_center,
  p.center AS precise_center,
  CASE
    WHEN p.work_zone IS NULL THEN NULL
    ELSE ST_Multi(ST_SnapToGrid(p.work_zone, 0.0025))::geometry(MultiPolygon, 4326)
  END AS public_work_zone,
  p.work_zone AS precise_work_zone
FROM twin.construction_projects p
WHERE p.publication_state = 'published'
  AND p.classification = 'public';

COMMENT ON VIEW twin.public_projects IS '公開承認済み案件のみ。代表点・工区は 250m メッシュへ丸めた public_* を返す';

CREATE OR REPLACE VIEW twin.public_features AS
SELECT
  f.feature_id,
  f.project_id,
  f.feature_kind,
  f.name,
  CASE
    WHEN f.public_precision_m IS NULL THEN f.geometry
    ELSE ST_SnapToGrid(f.geometry, f.public_precision_m / 111320.0)
  END AS geometry,
  f.geometry_type,
  f.valid_from,
  f.valid_to,
  f.source_provider,
  f.updated_at
FROM twin.construction_features f
JOIN twin.construction_projects p ON p.project_id = f.project_id
WHERE f.public_geometry = true
  AND p.publication_state = 'published'
  AND p.classification = 'public';

-- ============================================================================
-- 9. 空間検索関数
-- ============================================================================

-- 指定地点の近傍にある施工中現場を距離順に返す（REQ-F-001 / PostGIS 活用）
CREATE OR REPLACE FUNCTION twin.nearby_projects(
  p_lng double precision,
  p_lat double precision,
  p_radius_m double precision DEFAULT 500,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  project_id text,
  official_name text,
  public_title text,
  category text,
  status text,
  municipality text,
  address text,
  distance_m double precision,
  inside_work_zone boolean
)
LANGUAGE sql STABLE AS $$
  WITH origin AS (
    SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) AS geom
  )
  SELECT
    p.project_id,
    p.official_name,
    p.public_title,
    p.category,
    p.status,
    p.municipality,
    p.address,
    ST_Distance(p.center::geography, o.geom::geography) AS distance_m,
    COALESCE(ST_Intersects(p.work_zone, o.geom), false) AS inside_work_zone
  FROM twin.construction_projects p, origin o
  WHERE p.publication_state = 'published'
    AND p.classification = 'public'
    AND ST_DWithin(p.center::geography, o.geom::geography, p_radius_m)
  ORDER BY distance_m
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

COMMENT ON FUNCTION twin.nearby_projects IS '住所座標・地図クリック地点から半径 p_radius_m 以内の公開現場を距離順に返す';

-- 指定地点を含む施工範囲（工区・規制・迂回路）を返す
CREATE OR REPLACE FUNCTION twin.features_containing(
  p_lng double precision,
  p_lat double precision,
  p_kinds text[] DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  feature_id text,
  project_id text,
  feature_kind text,
  name text,
  geometry_type text,
  distance_m double precision
)
LANGUAGE sql STABLE AS $$
  WITH origin AS (
    SELECT ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) AS geom
  )
  SELECT
    f.feature_id,
    f.project_id,
    f.feature_kind,
    f.name,
    f.geometry_type,
    0::double precision AS distance_m
  FROM twin.construction_features f
  JOIN twin.construction_projects p ON p.project_id = f.project_id, origin o
  WHERE f.public_geometry = true
    AND p.publication_state = 'published'
    AND p.classification = 'public'
    AND (p_kinds IS NULL OR f.feature_kind = ANY (p_kinds))
    AND ST_Intersects(f.geometry, o.geom)
  ORDER BY f.feature_kind, f.feature_id
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

-- 表示時刻に有効な影響イベント（時間軸 REQ-F-008）
CREATE OR REPLACE FUNCTION twin.impacts_active_at(
  p_at date,
  p_project_id text DEFAULT NULL
)
RETURNS TABLE (
  impact_id text,
  project_id text,
  type text,
  severity text,
  title text,
  description text,
  active_from date,
  active_to date,
  recurrence text
)
LANGUAGE sql STABLE AS $$
  SELECT
    i.impact_id, i.project_id, i.type, i.severity, i.title, i.description,
    i.active_from, i.active_to, i.recurrence
  FROM twin.impact_events i
  JOIN twin.construction_projects p ON p.project_id = i.project_id
  WHERE p.publication_state = 'published'
    AND p.classification = 'public'
    AND (p_project_id IS NULL OR i.project_id = p_project_id)
    AND (i.active_from IS NULL OR i.active_from <= p_at)
    AND (i.active_to IS NULL OR i.active_to >= p_at)
  ORDER BY i.severity DESC, i.active_from NULLS LAST, i.impact_id;
$$;
