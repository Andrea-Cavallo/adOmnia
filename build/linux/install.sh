#!/usr/bin/env bash
# install.sh — installa adOmnia su Linux con icone hicolor complete
# Uso: sudo ./install.sh
set -e

INSTALL_DIR="/opt/adOmnia"
DESKTOP_DIR="/usr/share/applications"
HICOLOR_BASE="/usr/share/icons/hicolor"

if [ "$(id -u)" -ne 0 ]; then
    echo "Riesegui con sudo: sudo ./install.sh"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installazione binary in $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/adOmnia" "$INSTALL_DIR/adOmnia"
chmod +x "$INSTALL_DIR/adOmnia"

echo "==> Installazione icone hicolor ..."
ICON_SIZES=(16 24 32 48 64 128 256 512)
for sz in "${ICON_SIZES[@]}"; do
    SRC="$SCRIPT_DIR/icons/adOmnia_${sz}x${sz}.png"
    DEST_DIR="$HICOLOR_BASE/${sz}x${sz}/apps"
    if [ -f "$SRC" ]; then
        mkdir -p "$DEST_DIR"
        cp "$SRC" "$DEST_DIR/adOmnia.png"
        echo "    ${sz}x${sz} -> $DEST_DIR/adOmnia.png"
    else
        echo "    ATTENZIONE: $SRC non trovata, skipped"
    fi
done

# Fallback single-icon copy (for environments that look in app dir)
if [ -f "$SCRIPT_DIR/adOmnia.png" ]; then
    cp "$SCRIPT_DIR/adOmnia.png" "$INSTALL_DIR/adOmnia.png"
fi

echo "==> Aggiornamento icon cache ..."
gtk-update-icon-cache -f -t "$HICOLOR_BASE" 2>/dev/null || true
xdg-icon-resource forceupdate 2>/dev/null || true

echo "==> Installazione .desktop ..."
cp "$SCRIPT_DIR/adOmnia.desktop" "$DESKTOP_DIR/adOmnia.desktop"
chmod 644 "$DESKTOP_DIR/adOmnia.desktop"
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo ""
echo "Installazione completata. Avvia adOmnia dal launcher o con:"
echo "  /opt/adOmnia/adOmnia"
