#!/bin/bash
# One entry point: scale streamer + kiosk browser.
# Prefer systemd units from install.sh for boot; this is for manual / debug.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${NOBELCART_ENV:-/etc/nobelcart/kiosk.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PI_SCALE_DIR="${PI_SCALE_DIR:-$(cd "$HERE/.." && pwd)}"
cd "$PI_SCALE_DIR"

if [[ ! -f config.json ]]; then
  echo "ERROR: missing $PI_SCALE_DIR/config.json (copy from config.example.json)" >&2
  exit 1
fi

# Keep cart_id in sync with kiosk env when set
if [[ -n "${CART_ID:-}" ]] && command -v python3 >/dev/null; then
  python3 - <<PY
import json
from pathlib import Path
p = Path("config.json")
cfg = json.loads(p.read_text())
if cfg.get("cart_id") != "${CART_ID}":
    cfg["cart_id"] = "${CART_ID}"
    p.write_text(json.dumps(cfg, indent=2) + "\n")
    print("Updated config.json cart_id -> ${CART_ID}")
PY
fi

pkill -f "scale_stream.py" >/dev/null 2>&1 || true
python3 "$PI_SCALE_DIR/scale_stream.py" &
SCALE_PID=$!
echo "Scale PID: $SCALE_PID"

cleanup() {
  kill "$SCALE_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

exec "$HERE/start-browser.sh"
