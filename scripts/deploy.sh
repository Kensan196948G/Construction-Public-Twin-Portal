#!/usr/bin/env bash
#
# 本番デプロイ: 停止 → ビルド → 起動 → 到達確認
#
#   sudo bash scripts/deploy.sh
#
# なぜサービスを止めてからビルドするのか:
#   稼働中の next start が参照している .next を書き換えると、
#   実行中プロセスのクライアント参照マニフェストが失われ
#     InvariantError: The client reference manifest for route "/_not-found" does not exist
#   が発生し、以後 502/500 を返し続ける。
#   そのため必ず「停止 → ビルド → 起動」の順で行う。
set -euo pipefail

UNIT_NAME="${UNIT_NAME:-construction-public-twin-portal}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_DIR}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: root 権限が必要です（sudo bash scripts/deploy.sh）。" >&2
  exit 1
fi

RUN_AS="${SERVICE_USER:-kensan}"

echo "[deploy] サービスを停止します..."
systemctl stop "${UNIT_NAME}" || true

echo "[deploy] 依存関係を確認します..."
sudo -u "${RUN_AS}" npm install --no-audit --no-fund

echo "[deploy] 検証（lint / typecheck / test）..."
sudo -u "${RUN_AS}" npm run lint
sudo -u "${RUN_AS}" npm run typecheck
sudo -u "${RUN_AS}" npm test

echo "[deploy] 本番ビルド..."
sudo -u "${RUN_AS}" npm run build

echo "[deploy] サービスを起動します..."
systemctl start "${UNIT_NAME}"

PORT="$(systemctl show "${UNIT_NAME}" -p Environment | grep -o 'PORT=[0-9]*' | cut -d= -f2)"
PORT="${PORT:-43100}"

echo "[deploy] 到達確認..."
ok=0
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:${PORT}/"; then
    ok=1
    break
  fi
  sleep 1
done

IP="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -E '^(192|10|172)\.' | head -1)"
IP="${IP:-127.0.0.1}"

if [[ "${ok}" -eq 1 ]]; then
  echo "[deploy] 完了: http://${IP}:${PORT}/"
else
  echo "[deploy] ERROR: HTTP 応答を確認できませんでした。" >&2
  systemctl status "${UNIT_NAME}" --no-pager -l | head -30 >&2
  exit 1
fi
