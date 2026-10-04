#!/usr/bin/env bash
#
# 工事データを PostGIS へ投入する。
#
#   bash scripts/db-ingest.sh          # 通常（kensan ユーザー）
#   sudo bash scripts/db-ingest.sh     # root から実行しても kensan に降格して実行する
#
# DATABASE_URL は /etc/construction-public-twin-portal/env から読む
# （scripts/db-init.sh が生成する）。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_DIR}"

ENV_FILE="${ENV_FILE:-/etc/construction-public-twin-portal/env}"
SERVICE_USER="${SERVICE_USER:-kensan}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} が見つかりません。先に scripts/db-init.sh を実行してください。" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "${ENV_FILE}"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL が ${ENV_FILE} に定義されていません。" >&2
  exit 1
fi

# root から実行された場合はサービスユーザーへ降格する。
# 理由: node / npm は nvm 配下にあり root の PATH に無い。
#       DATABASE_URL は sudo の env_reset で消えるため明示的に渡す。
as_service_user() {
  if [[ "${EUID}" -eq 0 && "${SERVICE_USER}" != "root" ]]; then
    sudo -u "${SERVICE_USER}" env "DATABASE_URL=${DATABASE_URL}" "$@"
  else
    "$@"
  fi
}

# 公開データが無ければ生成する
if [[ ! -f "${PROJECT_DIR}/public/data/projects/index.json" ]]; then
  echo "[db-ingest] public/data が未生成のため export:data を実行します..."
  as_service_user npm run export:data
fi

echo "[db-ingest] 工事データを生成し PostGIS へ投入します..."
as_service_user node scripts/db-ingest.mjs --apply

echo "[db-ingest] 投入結果を確認します..."
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -P pager=off -c "
  SELECT 'projects' AS kind, count(*) FROM twin.construction_projects
  UNION ALL SELECT 'features', count(*) FROM twin.construction_features
  UNION ALL SELECT 'impacts', count(*) FROM twin.impact_events
  UNION ALL SELECT 'provenance', count(*) FROM twin.data_provenance
  UNION ALL SELECT 'sources', count(*) FROM twin.source_registry
  UNION ALL SELECT 'public_projects', count(*) FROM twin.public_projects;
"

echo "[db-ingest] 空間検索の疎通確認（田園調布駅前 500m 以内）..."
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -P pager=off -c "
  SELECT project_id, left(public_title, 28) AS title, round(distance_m::numeric, 1) AS distance_m, inside_work_zone
    FROM twin.nearby_projects(139.6680, 35.5930, 500, 5);
"

echo "[db-ingest] 完了"
