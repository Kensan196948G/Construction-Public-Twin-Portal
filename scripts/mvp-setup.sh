#!/usr/bin/env bash
#
# MVP 環境の一式セットアップ。
#
#   sudo bash scripts/mvp-setup.sh
#
# 実行内容（すべて冪等）:
#   1. 依存のインストール（npm install）
#   2. PostGIS の初期化（ロール・DB・スキーマ・環境ファイル）
#   3. systemd への環境ファイル受け渡し（drop-in）
#   4. 公開データの生成（npm run export:data）
#   5. 工事データの PostGIS 投入
#   6. サービス再起動と到達確認
#
# 個別に実行したい場合は db-init.sh / service-env.sh / db-ingest.sh / deploy.sh を使う。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_DIR}"

SERVICE_USER="${SERVICE_USER:-kensan}"
UNIT_NAME="${UNIT_NAME:-construction-public-twin-portal}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: root 権限が必要です（sudo bash scripts/mvp-setup.sh）。" >&2
  exit 1
fi

echo "=============================================="
echo " 工事みえるマップ 3D Beta — MVP 環境セットアップ"
echo " プロジェクト: ${PROJECT_DIR}"
echo "=============================================="

if ! command -v node >/dev/null 2>&1 && [[ ! -s "${HOME}/.nvm/nvm.sh" ]]; then
  echo "ERROR: node が見つかりません。" >&2
  exit 1
fi

echo
echo "[1/6] 依存をインストールします..."
sudo -u "${SERVICE_USER}" bash -lc 'source ~/.nvm/nvm.sh 2>/dev/null || true; cd "'"${PROJECT_DIR}"'" && npm install --no-audit --no-fund'

echo
echo "[2/6] PostGIS を初期化します..."
bash scripts/db-init.sh

echo
echo "[3/6] systemd へ環境ファイルを渡します..."
bash scripts/service-env.sh

echo
echo "[4/6] 公開データを生成します..."
sudo -u "${SERVICE_USER}" bash -lc 'source ~/.nvm/nvm.sh 2>/dev/null || true; cd "'"${PROJECT_DIR}"'" && npm run export:data'

echo
echo "[5/6] 工事データを PostGIS へ投入します..."
bash scripts/db-ingest.sh

echo
echo "[6/6] ビルドしてサービスを再起動します..."
bash scripts/deploy.sh

echo
echo "=============================================="
echo " 完了"
PORT="$(systemctl show "${UNIT_NAME}" -p Environment | grep -o 'PORT=[0-9]*' | cut -d= -f2)"
PORT="${PORT:-43100}"
IP="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -E '^(192|10)\.' | head -1)"
IP="${IP:-127.0.0.1}"
echo "  アプリ     : http://${IP}:${PORT}/"
echo "  ヘルス     : http://${IP}:${PORT}/api/health"
echo "  ジオコーダ : http://${IP}:${PORT}/api/geocode?q=東京都千代田区丸の内一丁目9番"
echo "  現場台帳   : http://${IP}:${PORT}/api/ledger?keyword=田園調布"
echo "  空間検索   : http://${IP}:${PORT}/api/geo/nearby?lng=139.668&lat=35.593&radius=500"
echo "=============================================="
