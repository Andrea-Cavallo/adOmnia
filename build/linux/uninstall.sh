#!/usr/bin/env bash
# uninstall.sh - remove adOmnia Linux native install
# Usage: sudo ./uninstall.sh
set -e

INSTALL_DIR="/opt/adOmnia"
DESKTOP_FILE="/usr/share/applications/adOmnia.desktop"
HICOLOR_BASE="/usr/share/icons/hicolor"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo: sudo ./uninstall.sh"
    exit 1
fi

echo "==> Removing adOmnia binary and app files ..."
rm -rf "$INSTALL_DIR"

echo "==> Removing desktop entry ..."
rm -f "$DESKTOP_FILE"
update-desktop-database "/usr/share/applications" 2>/dev/null || true

echo "==> Removing hicolor icons ..."
for sz in 16 24 32 48 64 128 256 512; do
    rm -f "$HICOLOR_BASE/${sz}x${sz}/apps/adOmnia.png"
done

gtk-update-icon-cache -f -t "$HICOLOR_BASE" 2>/dev/null || true
xdg-icon-resource forceupdate 2>/dev/null || true

echo "adOmnia removed."
