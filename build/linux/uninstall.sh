#!/usr/bin/env bash
# uninstall.sh - remove adOmnia Linux native install
# Usage: ./uninstall.sh (without sudo); application data is preserved.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
    echo "Run ./uninstall.sh as your normal user, without sudo." >&2
    exit 1
fi

INSTALL_DIR="$HOME/.local/bin"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
[[ "$DATA_DIR" == /* ]] || { echo "XDG_DATA_HOME must be an absolute path." >&2; exit 1; }
DESKTOP_FILE="$DATA_DIR/applications/adomnia.desktop"
HICOLOR_BASE="$DATA_DIR/icons/hicolor"

echo "==> Removing adOmnia binary and app files ..."
rm -f "$INSTALL_DIR/adomnia"
rm -f "$DATA_DIR/adomnia/adomnia.png"

echo "==> Removing desktop entry ..."
rm -f "$DESKTOP_FILE"
update-desktop-database "$DATA_DIR/applications" 2>/dev/null || true

echo "==> Removing hicolor icons ..."
for sz in 16 24 32 48 64 128 256 512; do
    rm -f "$HICOLOR_BASE/${sz}x${sz}/apps/adomnia.png"
done
rm -f "$HICOLOR_BASE/scalable/apps/adomnia-symbolic.svg"

gtk-update-icon-cache -f -t "$HICOLOR_BASE" 2>/dev/null || true
xdg-icon-resource forceupdate 2>/dev/null || true

echo "adOmnia removed. Workspaces, settings and any legacy /opt installation were preserved."
