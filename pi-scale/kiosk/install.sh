#!/bin/bash
# Install NobelCart auto-boot: scale + fullscreen Chromium kiosk.
# Run ONCE on the Pi:  sudo bash kiosk/install.sh

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root:  sudo bash kiosk/install.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCALE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REAL_USER="${SUDO_USER:-pi}"
REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"
REAL_UID="$(id -u "$REAL_USER")"

echo "Installing for user=$REAL_USER  scale_dir=$SCALE_DIR"

apt-get update
apt-get install -y \
  python3-libgpiod \
  python3-requests \
  chromium \
  unclutter \
  x11-xserver-utils || apt-get install -y chromium-browser unclutter x11-xserver-utils

mkdir -p /etc/nobelcart
ENV_DST=/etc/nobelcart/kiosk.env
if [[ ! -f "$ENV_DST" ]]; then
  cp "$SCRIPT_DIR/kiosk.env.example" "$ENV_DST"
  # Point paths at this install
  sed -i "s|^PI_SCALE_DIR=.*|PI_SCALE_DIR=$SCALE_DIR|" "$ENV_DST"
  sed -i "s|^KIOSK_USER=.*|KIOSK_USER=$REAL_USER|" "$ENV_DST"
  chmod 600 "$ENV_DST"
  echo "Created $ENV_DST — edit SITE_URL, CART_ID, SUPABASE_SERVICE_ROLE_KEY"
else
  echo "Keeping existing $ENV_DST"
fi

if [[ ! -f "$SCALE_DIR/config.json" ]]; then
  cp "$SCALE_DIR/config.example.json" "$SCALE_DIR/config.json"
  chown "$REAL_USER:$REAL_USER" "$SCALE_DIR/config.json"
  echo "Created $SCALE_DIR/config.json — set cart_id to match CART_ID"
fi

chmod +x "$SCRIPT_DIR/start-browser.sh" "$SCRIPT_DIR/start-all.sh" "$SCRIPT_DIR/install.sh"

# Patch unit files to this path + user
SCALE_UNIT=/etc/systemd/system/nobelcart-scale.service
KIOSK_UNIT=/etc/systemd/system/nobelcart-kiosk.service

cat > "$SCALE_UNIT" <<EOF
[Unit]
Description=NobelCart scale streamer (HX711 → Supabase)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$REAL_USER
Group=$REAL_USER
EnvironmentFile=-/etc/nobelcart/kiosk.env
WorkingDirectory=$SCALE_DIR
ExecStart=/usr/bin/python3 $SCALE_DIR/scale_stream.py
Restart=always
RestartSec=3
Nice=5

[Install]
WantedBy=multi-user.target
EOF

cat > "$KIOSK_UNIT" <<EOF
[Unit]
Description=NobelCart Chromium touch kiosk
After=graphical.target network-online.target nobelcart-scale.service
Wants=network-online.target nobelcart-scale.service

[Service]
Type=simple
User=$REAL_USER
Group=$REAL_USER
EnvironmentFile=-/etc/nobelcart/kiosk.env
Environment=DISPLAY=:0
Environment=XDG_RUNTIME_DIR=/run/user/$REAL_UID
Environment=WAYLAND_DISPLAY=wayland-0
ExecStartPre=/bin/sleep 5
ExecStart=$SCRIPT_DIR/start-browser.sh
Restart=always
RestartSec=5

[Install]
WantedBy=graphical.target
EOF

# Autostart: browser only. systemd owns nobelcart-scale — start-all.sh would
# launch a second scale_stream.py (GPIO fight + extra CPU).
AUTOSTART_DIR="$REAL_HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/nobelcart-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=NobelCart Kiosk
Exec=$SCRIPT_DIR/start-browser.sh
X-GNOME-Autostart-enabled=true
Hidden=false
NoDisplay=false
EOF
chown -R "$REAL_USER:$REAL_USER" "$AUTOSTART_DIR"

# Reduce desktop clutter: auto-login is configured in raspi-config by the operator.
# Disable Chromium crash/restore nag via policy if directory exists
POLICY_DIR=/etc/chromium/policies/managed
mkdir -p "$POLICY_DIR"
cat > "$POLICY_DIR/nobelcart.json" <<'EOF'
{
  "PasswordManagerEnabled": false,
  "AutofillAddressEnabled": false,
  "AutofillCreditCardEnabled": false,
  "BrowserSignin": 0,
  "TranslateEnabled": false,
  "DefaultPopupsSetting": 2,
  "DefaultNotificationsSetting": 2,
  "RestoreOnStartup": 5,
  "PromptForDownloadLocation": false,
  "DownloadRestrictions": 3,
  "SavingBrowserHistoryDisabled": true
}
EOF

systemctl daemon-reload
systemctl enable nobelcart-scale.service
systemctl enable nobelcart-kiosk.service

echo
echo "=== Install done ==="
echo "1) Edit:  sudo nano /etc/nobelcart/kiosk.env"
echo "     - SITE_URL=https://your-site/index.html"
echo "     - CART_ID=cart-1"
echo "     - SUPABASE_SERVICE_ROLE_KEY=..."
echo "2) Match cart_id in:  $SCALE_DIR/config.json"
echo "3) Auto-login desktop user (raspi-config → System → Auto Login)"
echo "4) Reboot:  sudo reboot"
echo
echo "Manual test without reboot:"
echo "  sudo systemctl start nobelcart-scale"
echo "  sudo -u $REAL_USER $SCRIPT_DIR/start-browser.sh"
echo
echo "If TWO browsers open after reboot, disable one path:"
echo "  sudo systemctl disable nobelcart-kiosk"
echo "  # keep ~/.config/autostart (start-browser.sh)  OR the opposite"
echo
echo "Optional energy trim (Bluetooth/CUPS/Avahi/NFS/cloud-init):"
echo "  sudo bash $SCRIPT_DIR/trim-idle.sh"
