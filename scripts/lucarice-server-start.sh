#!/usr/bin/env bash
# Start LucaRice after an AutoDL container boot. The named Cloudflare tunnel is
# started too once /root/.cloudflared/config.yml has been configured.

set -euo pipefail

PROJECT_DIR='/root/autodl-tmp/lucarice'
LOG_DIR="$PROJECT_DIR/.lucarice-data"
APP_PATTERN='node --import tsx/esm apps/cli/src/lucarice-bin.ts'

mkdir -p "$LOG_DIR"

set -a
. "$PROJECT_DIR/.env"
set +a

if ! pgrep -f "$APP_PATTERN" >/dev/null 2>&1; then
  cd "$PROJECT_DIR"
  nohup env DSH_CWD="$PROJECT_DIR" node --import tsx/esm apps/cli/src/lucarice-bin.ts \
    --profile web --host 0.0.0.0 --port 6006 \
    --trusted-host deepplant.cn --trusted-host www.deepplant.cn \
    > "$LOG_DIR/lucarice.log" 2>&1 < /dev/null &
fi

if [ -f '/root/.cloudflared/config.yml' ] && ! pgrep -f 'cloudflared.*tunnel.*run' >/dev/null 2>&1; then
  nohup cloudflared --config /root/.cloudflared/config.yml tunnel run \
    > "$LOG_DIR/cloudflared.log" 2>&1 < /dev/null &
fi
