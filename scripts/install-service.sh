#!/usr/bin/env bash
#
# 工事みえるマップ 3D Beta (MVP) を systemd サービスとして登録する。
#
#   sudo bash scripts/install-service.sh
#
# 動作:
#   1. 競合しない TCP ポートを自動選択（使用中なら次の候補へ）
#   2. 本番ビルド（.next）の存在を確認（無ければ npm run build を促す）
#   3. /etc/systemd/system/<unit> を作成
#   4. daemon-reload → enable --now
#   5. 到達確認して URL を表示
#
# 再実行は安全（既存ユニットを上書きする）。ポートを固定したい場合は
#   SERVICE_PORT=43100 sudo bash scripts/install-service.sh
set -euo pipefail

UNIT_NAME="${UNIT_NAME:-construction-public-twin-portal}"
SERVICE_USER="${SERVICE_USER:-kensan}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_PATH="/etc/systemd/system/${UNIT_NAME}.service"

# ---- 1. ポート選択 ----------------------------------------------------------
port_in_use() {
  ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | grep -qx "$1"
}

pick_port() {
  if [[ -n "${SERVICE_PORT:-}" ]]; then
    if port_in_use "${SERVICE_PORT}"; then
      echo "ERROR: 指定された SERVICE_PORT=${SERVICE_PORT} は既に使用中です。" >&2
      exit 1
    fi
    echo "${SERVICE_PORT}"
    return
  fi
  # 43100 から順に空きを探す（動的割当範囲 32768-60999 の外側を避けた固定レンジ）
  for p in $(seq 43100 43200); do
    if ! port_in_use "$p"; then
      echo "$p"
      return
    fi
  done
  echo "ERROR: 空きポートが見つかりませんでした。" >&2
  exit 1
}

PORT="$(pick_port)"

# ---- 2. 前提チェック --------------------------------------------------------
NODE_BIN="$(readlink -f "$(command -v node)")"
if [[ ! -x "${NODE_BIN}" ]]; then
  echo "ERROR: node が見つかりません。" >&2
  exit 1
fi

NEXT_BIN="${PROJECT_DIR}/node_modules/next/dist/bin/next"
if [[ ! -f "${NEXT_BIN}" ]]; then
  echo "ERROR: ${NEXT_BIN} がありません。先に npm install を実行してください。" >&2
  exit 1
fi

if [[ ! -d "${PROJECT_DIR}/.next" ]]; then
  echo "ERROR: 本番ビルド (.next) がありません。先に npm run build を実行してください。" >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: root 権限が必要です（sudo bash scripts/install-service.sh）。" >&2
  exit 1
fi

# ---- 3. ユニット作成 --------------------------------------------------------
# すべてのインターフェースで待ち受ける。URL は自動割当 IP を実行時に表示する。
cat >"${UNIT_PATH}" <<UNIT
[Unit]
Description=工事みえるマップ 3D Beta / Construction Public Twin Portal (MVP)
Documentation=file://${PROJECT_DIR}/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${PROJECT_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=NEXT_TELEMETRY_DISABLED=1
ExecStart=${NODE_BIN} ${NEXT_BIN} start -H 0.0.0.0 -p ${PORT}
Restart=on-failure
RestartSec=3

# セキュリティ強化。
# NOTE: ProtectHome=read-only は使わない。アプリ本体が /home 配下にあり、
#       Next.js が .next へ書き込むため、ホームを読み取り専用にすると起動に失敗する。
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT

# ---- 4. 有効化 --------------------------------------------------------------
systemctl daemon-reload
systemctl enable "${UNIT_NAME}" >/dev/null
systemctl restart "${UNIT_NAME}"

# ---- 5. 到達確認 ------------------------------------------------------------
echo "起動を待っています..."
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

echo
if [[ "${ok}" -eq 1 ]]; then
  echo "=============================================="
  echo " 工事みえるマップ 3D Beta  (systemd: ${UNIT_NAME})"
  echo "=============================================="
  echo " URL          : http://${IP}:${PORT}/"
  echo " ローカル      : http://127.0.0.1:${PORT}/"
  echo " ユニット      : ${UNIT_PATH}"
  echo " 状態          : $(systemctl is-active "${UNIT_NAME}") / $(systemctl is-enabled "${UNIT_NAME}")"
  echo
  echo " 操作:"
  echo "   sudo systemctl status ${UNIT_NAME}"
  echo "   sudo systemctl restart ${UNIT_NAME}"
  echo "   sudo systemctl stop ${UNIT_NAME}"
  echo "   sudo journalctl -u ${UNIT_NAME} -f"
  echo "=============================================="
else
  echo "ERROR: サービスは起動しましたが HTTP 応答を確認できませんでした。" >&2
  systemctl status "${UNIT_NAME}" --no-pager -l | head -30 >&2
  exit 1
fi
