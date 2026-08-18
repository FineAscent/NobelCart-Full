#!/bin/bash
# Safe energy trim for a NobelCart cart Pi.
# Disables unused radios/services. Does not touch Wi-Fi, LightDM, SSH, or NobelCart units.
#
#   sudo bash kiosk/trim-idle.sh
#   sudo bash kiosk/trim-idle.sh --also-connect   # also stop Raspberry Pi Connect / wayvnc
#   sudo bash kiosk/trim-idle.sh --undo

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root:  sudo bash $0" >&2
  exit 1
fi

ALSO_CONNECT=0
UNDO=0
for arg in "$@"; do
  case "$arg" in
    --also-connect) ALSO_CONNECT=1 ;;
    --undo) UNDO=1 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (try --also-connect or --undo)" >&2
      exit 1
      ;;
  esac
done

KIOSK_USER="${SUDO_USER:-noblecart01}"
KIOSK_UID="$(id -u "$KIOSK_USER" 2>/dev/null || echo 1000)"

# Never touch these.
PROTECTED='^(NetworkManager|wpa_supplicant|lightdm|ssh|sshd|nobelcart-|dbus|systemd-timesyncd|polkit|user@)'

UNITS=(
  bluetooth.service
  cups.service
  cups.socket
  cups.path
  avahi-daemon.service
  avahi-daemon.socket
  rpcbind.service
  rpcbind.socket
  nfs-client.target
  nfs-blkmap.service
  cloud-init.service
  cloud-init-local.service
  cloud-init-main.service
  cloud-init-network.service
  cloud-final.service
  cloud-config.service
  cloud-init-hotplugd.socket
)

unit_exists() {
  systemctl list-unit-files "$1" --no-legend --no-pager >/dev/null 2>&1 \
    || systemctl status "$1" >/dev/null 2>&1 \
    || [[ -n "$(systemctl show -p LoadState --value "$1" 2>/dev/null)" \
         && "$(systemctl show -p LoadState --value "$1" 2>/dev/null)" != "not-found" ]]
}

show_unit() {
  local u="$1"
  local active enabled
  active="$(systemctl is-active "$u" 2>/dev/null || true)"
  enabled="$(systemctl is-enabled "$u" 2>/dev/null || true)"
  printf '  %-36s  active=%-12s enabled=%s\n' "$u" "${active:-n/a}" "${enabled:-n/a}"
}

echo "=== Before ==="
for u in "${UNITS[@]}"; do
  show_unit "$u"
done
echo "  bluetooth radio: $(rfkill list bluetooth 2>/dev/null | tr '\n' ' ' || echo n/a)"

if [[ "$UNDO" -eq 1 ]]; then
  echo
  echo "=== Undo: unmask + enable ==="
  for u in "${UNITS[@]}"; do
    if [[ "$u" =~ $PROTECTED ]]; then
      echo "SKIP protected $u" >&2
      continue
    fi
    systemctl unmask "$u" >/dev/null 2>&1 || true
    if unit_exists "$u"; then
      systemctl enable --now "$u" >/dev/null 2>&1 || systemctl enable "$u" >/dev/null 2>&1 || true
    fi
  done
  rfkill unblock bluetooth >/dev/null 2>&1 || true
  if [[ "$ALSO_CONNECT" -eq 1 ]]; then
    sudo -u "$KIOSK_USER" XDG_RUNTIME_DIR="/run/user/$KIOSK_UID" \
      DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$KIOSK_UID/bus" \
      systemctl --user enable --now rpi-connect.service >/dev/null 2>&1 || true
  fi
  echo "Undone. Bluetooth unblocked."
  echo
  echo "=== After ==="
  for u in "${UNITS[@]}"; do
    show_unit "$u"
  done
  exit 0
fi

echo
echo "=== Disable + mask unused units ==="
for u in "${UNITS[@]}"; do
  if [[ "$u" =~ $PROTECTED ]]; then
    echo "SKIP protected $u" >&2
    continue
  fi
  if ! unit_exists "$u"; then
    printf '  %-36s  skip (not installed)\n' "$u"
    continue
  fi
  systemctl disable --now "$u" >/dev/null 2>&1 || true
  systemctl mask "$u" >/dev/null 2>&1 || true
  printf '  %-36s  masked\n' "$u"
done

if command -v rfkill >/dev/null; then
  rfkill block bluetooth || true
  echo "  rfkill: bluetooth blocked"
fi

if [[ "$ALSO_CONNECT" -eq 1 ]]; then
  echo
  echo "=== Also stopping Raspberry Pi Connect ==="
  sudo -u "$KIOSK_USER" XDG_RUNTIME_DIR="/run/user/$KIOSK_UID" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$KIOSK_UID/bus" \
    systemctl --user disable --now rpi-connect.service >/dev/null 2>&1 || true
  sudo -u "$KIOSK_USER" XDG_RUNTIME_DIR="/run/user/$KIOSK_UID" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$KIOSK_UID/bus" \
    systemctl --user disable --now rpi-connectd.service >/dev/null 2>&1 || true
  pkill -u "$KIOSK_USER" -x wayvnc >/dev/null 2>&1 || true
  pkill -u "$KIOSK_USER" -x rpi-connectd >/dev/null 2>&1 || true
  echo "  rpi-connect / wayvnc stopped for $KIOSK_USER"
fi

echo
echo "=== After ==="
for u in "${UNITS[@]}"; do
  show_unit "$u"
done
echo "  bluetooth radio: $(rfkill list bluetooth 2>/dev/null | tr '\n' ' ' || echo n/a)"
echo
echo "Kept: NetworkManager, wpa_supplicant, lightdm, ssh, nobelcart-*."
echo "Undo:  sudo bash $0 --undo"
echo "Pi Connect was left running unless you passed --also-connect."
