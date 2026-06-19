#!/usr/bin/env bash
# install.sh — installa adOmnia su Linux con icone hicolor complete
# Uso: sudo ./install.sh
set -e

INSTALL_DIR="/opt/adomnia"
DESKTOP_DIR="/usr/share/applications"
HICOLOR_BASE="/usr/share/icons/hicolor"

if [ "$(id -u)" -ne 0 ]; then
    echo "Riesegui con sudo: sudo ./install.sh"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installazione binary in $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/adomnia" "$INSTALL_DIR/adomnia"
chmod +x "$INSTALL_DIR/adomnia"

echo "==> Installazione icone hicolor ..."
ICON_SIZES=(16 24 32 48 64 128 256 512)
for sz in "${ICON_SIZES[@]}"; do
    SRC="$SCRIPT_DIR/icons/adomnia_${sz}x${sz}.png"
    DEST_DIR="$HICOLOR_BASE/${sz}x${sz}/apps"
    if [ -f "$SRC" ]; then
        mkdir -p "$DEST_DIR"
        cp "$SRC" "$DEST_DIR/adomnia.png"
        echo "    ${sz}x${sz} -> $DEST_DIR/adomnia.png"
    else
        echo "    ATTENZIONE: $SRC non trovata, skipped"
    fi
done

# Fallback single-icon copy (for environments that look in app dir)
if [ -f "$SCRIPT_DIR/adomnia.png" ]; then
    cp "$SCRIPT_DIR/adomnia.png" "$INSTALL_DIR/adomnia.png"
fi

echo "==> Aggiornamento icon cache ..."
gtk-update-icon-cache -f -t "$HICOLOR_BASE" 2>/dev/null || true
xdg-icon-resource forceupdate 2>/dev/null || true

echo "==> Installazione .desktop ..."
cp "$SCRIPT_DIR/adomnia.desktop" "$DESKTOP_DIR/adomnia.desktop"
chmod 644 "$DESKTOP_DIR/adomnia.desktop"
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo ""
echo "Installazione completata. Avvia adOmnia dal launcher o con:"
echo "  /opt/adomnia/adomnia"
