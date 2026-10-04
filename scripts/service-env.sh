#!/usr/bin/env bash
#
# systemd サービスへ環境ファイルを渡すための drop-in を作成する。
#
#   sudo bash scripts/service-env.sh
#
# なぜ drop-in なのか:
#   メインのユニット定義（install-service.sh が生成）を書き換えると、
#   再インストール時に衝突する。drop-in なら追加・削除が独立して行える。
#
# 作成物:
#   /etc/systemd/system/<unit>.service.d/10-env.conf
#     [Service]
#     EnvironmentFile=-/etc/construction-public-twin-portal/env
#
# 環境ファイルが無くてもサービスは起動する（`-` プレフィックス）。
set -euo pipefail

UNIT_NAME="${UNIT_NAME:-construction-public-twin-portal}"
ENV_FILE="${ENV_FILE:-/etc/construction-public-twin-portal/env}"
DROPIN_DIR="/etc/systemd/system/${UNIT_NAME}.service.d"
DROPIN_FILE="${DROPIN_DIR}/10-env.conf"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: root 権限が必要です（sudo bash scripts/service-env.sh）。" >&2
  exit 1
fi

if ! systemctl list-unit-files "${UNIT_NAME}.service" >/dev/null 2>&1; then
  echo "WARN: ${UNIT_NAME}.service が見つかりません。先に scripts/install-service.sh を実行してください。" >&2
fi

mkdir -p "${DROPIN_DIR}"
cat > "${DROPIN_FILE}" <<CONF
# 自動生成: scripts/service-env.sh
# 工事みえるマップ 3D Beta — PostGIS 接続情報などをサービスへ渡す。
#
# 秘密情報を含むため、このファイルはリポジトリへコミットしない。
# DATABASE_URL などは ${ENV_FILE} に定義する（scripts/db-init.sh が生成）。
[Service]
EnvironmentFile=-${ENV_FILE}
CONF

chmod 0644 "${DROPIN_FILE}"
systemctl daemon-reload

echo "[service-env] drop-in を書き出しました: ${DROPIN_FILE}"

if [[ -f "${ENV_FILE}" ]]; then
  echo "[service-env] 環境ファイル: ${ENV_FILE}"
  # 秘密の値そのものは出さない。キー名だけを示す。
  grep -oE '^[A-Z_][A-Z0-9_]*=' "${ENV_FILE}" | tr -d '=' | sed 's/^/  - /'
else
  echo "[service-env] 注意: ${ENV_FILE} がまだありません（サービスは起動しますが DB 未接続になります）。"
  echo "[service-env]       先に sudo bash scripts/db-init.sh を実行してください。"
fi

echo "[service-env] 反映するにはサービスを再起動してください:"
echo "  sudo systemctl restart ${UNIT_NAME}"
