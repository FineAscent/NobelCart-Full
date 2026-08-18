#!/bin/bash
# Start Chromium locked down for touch kiosk use.
# Called by systemd (nobelcart-kiosk.service) or manually.

set -euo pipefail

ENV_FILE="${NOBELCART_ENV:-/etc/nobelcart/kiosk.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

CART_ID="${CART_ID:-cart-1}"
SITE_URL="${SITE_URL:-}"
KIOSK_USER="${KIOSK_USER:-pi}"
PI_SCALE_DIR="${PI_SCALE_DIR:-$HOME/pi-scale}"

if [[ -z "$SITE_URL" || "$SITE_URL" == *"YOUR-SITE"* ]]; then
  echo "ERROR: Set SITE_URL in $ENV_FILE" >&2
  exit 1
fi

# Append ?cart= / &cart=
if [[ "$SITE_URL" == *"?"* ]]; then
  KIOSK_URL="${SITE_URL}&cart=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$CART_ID")"
else
  KIOSK_URL="${SITE_URL}?cart=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$CART_ID")"
fi

# Fresh profile every boot → no saved passwords / autofill / session restore
PROFILE_DIR="/tmp/nobelcart-chrome-${CART_ID}"
rm -rf "$PROFILE_DIR"
mkdir -p "$PROFILE_DIR"

# Find Chromium
if [[ -n "${CHROMIUM_BIN:-}" && -x "${CHROMIUM_BIN}" ]]; then
  CHROME="$CHROMIUM_BIN"
elif command -v chromium >/dev/null 2>&1; then
  CHROME="$(command -v chromium)"
elif command -v chromium-browser >/dev/null 2>&1; then
  CHROME="$(command -v chromium-browser)"
else
  echo "ERROR: chromium not installed (sudo apt install chromium)" >&2
  exit 1
fi

# Wait for a graphical session (X11 or Wayland)
for _ in $(seq 1 60); do
  if [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]; then
    break
  fi
  if [[ -S /tmp/.X11-unix/X0 ]]; then
    export DISPLAY=:0
    break
  fi
  if [[ -n "${XDG_RUNTIME_DIR:-}" && -S "${XDG_RUNTIME_DIR}/wayland-0" ]]; then
    export WAYLAND_DISPLAY=wayland-0
    break
  fi
  sleep 1
done

export DISPLAY="${DISPLAY:-:0}"

# Kill screen blanking when X is available
if command -v xset >/dev/null 2>&1 && [[ -n "${DISPLAY:-}" ]]; then
  xset s off >/dev/null 2>&1 || true
  xset -dpms >/dev/null 2>&1 || true
  xset s noblank >/dev/null 2>&1 || true
fi

# Hide mouse cursor (touch kiosk). Harmless if unclutter missing.
if command -v unclutter >/dev/null 2>&1; then
  pkill -x unclutter >/dev/null 2>&1 || true
  unclutter -idle 0.01 -root >/dev/null 2>&1 &
fi

# Extra preferences: no password save, no translate, no restore
PREF_DIR="$PROFILE_DIR/Default"
mkdir -p "$PREF_DIR"
cat > "$PREF_DIR/Preferences" <<'EOF'
{
  "credentials_enable_service": false,
  "profile": {
    "password_manager_enabled": false
  },
  "translate": {
    "enabled": false
  },
  "browser": {
    "has_seen_welcome_page": true,
    "custom_chrome_frame": false
  },
  "signin": {
    "allowed": false
  },
  "autofill": {
    "profile_enabled": false,
    "credit_card_enabled": false
  },
  "session": {
    "restore_on_startup": 5
  }
}
EOF

echo "Kiosk URL: $KIOSK_URL"
echo "Profile:   $PROFILE_DIR"
echo "Chrome:    $CHROME"

HERE="$(cd "$(dirname "$0")" && pwd)"
# Local splash first (instant logo), then redirect to live site
if [[ -f "$HERE/splash.html" && -f "$HERE/noble.png" ]]; then
  NEXT_ENC="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$KIOSK_URL")"
  START_URL="file://${HERE}/splash.html?next=${NEXT_ENC}"
  echo "Splash:    $START_URL"
else
  START_URL="$KIOSK_URL"
fi

exec "$CHROME" \
  --user-data-dir="$PROFILE_DIR" \
  --kiosk \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-features=TranslateUI,PasswordManagerOnboarding,AutofillServerCommunication \
  --disable-translate \
  --disable-notifications \
  --disable-component-update \
  --disable-sync \
  --disable-background-networking \
  --disable-breakpad \
  --disable-default-apps \
  --disable-hang-monitor \
  --disable-prompt-on-repost \
  --disable-domain-reliability \
  --disable-client-side-phishing-detection \
  --disable-save-password-bubble \
  --password-store=basic \
  --no-first-run \
  --no-default-browser-check \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  --force-device-scale-factor=1 \
  --touch-events=enabled \
  --enable-features=OverlayScrollbar \
  --ash-hide-cursor \
  --window-position=0,0 \
  --allow-file-access-from-files \
  "$START_URL"
