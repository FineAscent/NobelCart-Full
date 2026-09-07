#!/usr/bin/env bash
# Launch Chromium/Chrome with password manager + autofill disabled (Mac / Linux).
# Usage:
#   ./scripts/chrome-no-autofill.sh
#   ./scripts/chrome-no-autofill.sh http://127.0.0.1:8000/signin.html

set -euo pipefail

URL="${1:-http://127.0.0.1:8000/signin.html}"
PROFILE_DIR="${TMPDIR:-/tmp}/nobelcart-chrome-no-autofill"
rm -rf "$PROFILE_DIR"
mkdir -p "$PROFILE_DIR/Default"

cat > "$PROFILE_DIR/Default/Preferences" <<'EOF'
{
  "credentials_enable_service": false,
  "profile": { "password_manager_enabled": false },
  "autofill": { "profile_enabled": false, "credit_card_enabled": false },
  "signin": { "allowed": false },
  "translate": { "enabled": false }
}
EOF

find_chrome() {
  if command -v google-chrome >/dev/null 2>&1; then command -v google-chrome; return; fi
  if command -v chromium >/dev/null 2>&1; then command -v chromium; return; fi
  if command -v chromium-browser >/dev/null 2>&1; then command -v chromium-browser; return; fi
  if [[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
    echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; return
  fi
  if [[ -x "/Applications/Chromium.app/Contents/MacOS/Chromium" ]]; then
    echo "/Applications/Chromium.app/Contents/MacOS/Chromium"; return
  fi
  return 1
}

CHROME="$(find_chrome)" || { echo "Chrome/Chromium not found" >&2; exit 1; }

exec "$CHROME" \
  --user-data-dir="$PROFILE_DIR" \
  --disable-features=PasswordManagerOnboarding,AutofillServerCommunication,PasswordManager,AutofillEnableAccountWalletStorage,PasswordImport,BiometricAuthenticationForFilling \
  --disable-save-password-bubble \
  --disable-autofill-keyboard-accessory-view \
  --password-store=basic \
  --no-first-run \
  --no-default-browser-check \
  "$URL"
