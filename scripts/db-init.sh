#!/usr/bin/env bash
#
# PostGIS の初期化: ロール / データベース / 拡張 / スキーマを冪等に作成する。
#
#   sudo bash scripts/db-init.sh
#
# 作成物:
#   ロール      twin_portal（パスワードは自動生成し、環境ファイルへ保存）
#   データベース construction_twin（UTF8 / PostGIS 3.6）
#   スキーマ    twin（工事台帳・施工範囲・影響イベント・監査ログ）
#   環境ファイル /etc/construction-public-twin-portal/env（DATABASE_URL を保持）
#
# 何度実行しても安全。既存パスワードは環境ファイルにある値を再利用する。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_DIR}"

DB_NAME="${DB_NAME:-construction_twin}"
DB_ROLE="${DB_ROLE:-twin_portal}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
ENV_DIR="${ENV_DIR:-/etc/construction-public-twin-portal}"
ENV_FILE="${ENV_FILE:-${ENV_DIR}/env}"
SERVICE_USER="${SERVICE_USER:-kensan}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: root 権限が必要です（sudo bash scripts/db-init.sh）。" >&2
  exit 1
fi

echo "[db-init] PostgreSQL の稼働を確認します..."
if ! pg_isready -h "${DB_HOST}" -p "${DB_PORT}" >/dev/null 2>&1; then
  echo "ERROR: PostgreSQL (${DB_HOST}:${DB_PORT}) に接続できません。" >&2
  exit 1
fi

# --- パスワード: 既存の環境ファイルがあれば再利用する（再実行で URL を壊さない） ---
DB_PASSWORD=""
if [[ -f "${ENV_FILE}" ]]; then
  DB_PASSWORD="$(grep -E '^DATABASE_URL=' "${ENV_FILE}" | sed -E 's#^DATABASE_URL=postgres(ql)?://[^:]+:([^@]+)@.*#\2#' || true)"
  # URL エンコードされている場合に備えてデコードする
  DB_PASSWORD="$(printf '%b' "${DB_PASSWORD//%/\\x}")"
fi
if [[ -z "${DB_PASSWORD}" ]]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  echo "[db-init] 新しいロールパスワードを生成しました。"
else
  echo "[db-init] 既存のロールパスワードを再利用します。"
fi

echo "[db-init] ロール ${DB_ROLE} を用意します..."
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_ROLE}') THEN
    CREATE ROLE ${DB_ROLE} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_ROLE} LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SQL

echo "[db-init] データベース ${DB_NAME} を用意します..."
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O postgres -E UTF8 -T template0 "${DB_NAME}"
fi

echo "[db-init] 拡張（postgis / pg_trgm）を有効化します..."
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "${DB_NAME}" <<SQL
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL

echo "[db-init] スキーマを適用します（db/schema.sql）..."
# NOTE: プロジェクトはホーム配下にあり postgres ユーザーからは読めないため、
#       root シェルでリダイレクトして標準入力から流し込む（-f は使わない）。
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "${DB_NAME}" < "${PROJECT_DIR}/db/schema.sql"

echo "[db-init] 権限を ${DB_ROLE} へ付与します..."
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "${DB_NAME}" <<SQL
GRANT CONNECT ON DATABASE ${DB_NAME} TO ${DB_ROLE};
GRANT USAGE ON SCHEMA public TO ${DB_ROLE};
GRANT USAGE ON SCHEMA twin TO ${DB_ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA twin TO ${DB_ROLE};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA twin TO ${DB_ROLE};
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA twin TO ${DB_ROLE};
ALTER DEFAULT PRIVILEGES IN SCHEMA twin
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${DB_ROLE};
ALTER DEFAULT PRIVILEGES IN SCHEMA twin
  GRANT USAGE, SELECT ON SEQUENCES TO ${DB_ROLE};
ALTER DEFAULT PRIVILEGES IN SCHEMA twin
  GRANT EXECUTE ON FUNCTIONS TO ${DB_ROLE};
SQL

echo "[db-init] 環境ファイルを書き出します: ${ENV_FILE}"
mkdir -p "${ENV_DIR}"
DATABASE_URL="postgresql://${DB_ROLE}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

TMP_FILE="$(mktemp)"
{
  echo "# 工事みえるマップ 3D Beta — サービス用環境変数"
  echo "# 生成: scripts/db-init.sh ($(date -Iseconds))"
  echo "# このファイルは秘密情報を含む。リポジトリへコミットしないこと。"
  echo "DATABASE_URL=${DATABASE_URL}"
  echo "TWIN_DB_SCHEMA=twin"
} > "${TMP_FILE}"

# NEXT_PUBLIC_* はビルド時に埋め込まれるため、既存の値を引き継ぐ
if [[ -f "${ENV_FILE}" ]]; then
  grep -E '^NEXT_PUBLIC_[A-Z0-9_]+=' "${ENV_FILE}" >> "${TMP_FILE}" || true
fi

install -m 0640 -o root -g "${SERVICE_USER}" "${TMP_FILE}" "${ENV_FILE}"
rm -f "${TMP_FILE}"

echo "[db-init] 完了"
echo "  DATABASE_URL = postgresql://${DB_ROLE}:***@${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo "  環境ファイル = ${ENV_FILE}"
echo "  次: sudo bash scripts/db-ingest.sh"
