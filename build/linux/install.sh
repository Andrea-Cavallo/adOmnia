#!/usr/bin/env bash
# install.sh — installa adOmnia su Linux con icone hicolor complete
# Uso: ./install.sh (senza sudo)
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
    echo "Esegui ./install.sh come utente normale, senza sudo." >&2
    exit 1
fi

INSTALL_DIR="$HOME/.local/bin"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
[[ "$DATA_DIR" == /* ]] || { echo "XDG_DATA_HOME deve essere un percorso assoluto." >&2; exit 1; }
DESKTOP_DIR="$DATA_DIR/applications"
HICOLOR_BASE="$DATA_DIR/icons/hicolor"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installazione binary in $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/adomnia" "$INSTALL_DIR/adomnia"
chmod +x "$INSTALL_DIR/adomnia"

echo "==> Installazione icone hicolor ..."
ICON_SIZES=(16 24 32 48 64 128 256 512)
for sz in "${ICON_SIZES[@]}"; do
    SRC="$SCRIPT_DIR/icons/adOmnia_${sz}x${sz}.png"
    DEST_DIR="$HICOLOR_BASE/${sz}x${sz}/apps"
    if [ -f "$SRC" ]; then
        mkdir -p "$DEST_DIR"
        cp "$SRC" "$DEST_DIR/adomnia.png"
        echo "    ${sz}x${sz} -> $DEST_DIR/adomnia.png"
    else
        echo "    ATTENZIONE: $SRC non trovata, skipped"
    fi
done

if [ -f "$SCRIPT_DIR/icons/adomnia-symbolic.svg" ]; then
    mkdir -p "$HICOLOR_BASE/scalable/apps"
    cp "$SCRIPT_DIR/icons/adomnia-symbolic.svg" "$HICOLOR_BASE/scalable/apps/"
fi

# Fallback single-icon copy (for environments that look in app dir)
if [ -f "$SCRIPT_DIR/adomnia.png" ]; then
    mkdir -p "$DATA_DIR/adomnia"
    cp "$SCRIPT_DIR/adomnia.png" "$DATA_DIR/adomnia/adomnia.png"
fi

echo "==> Aggiornamento icon cache ..."
gtk-update-icon-cache -f -t "$HICOLOR_BASE" 2>/dev/null || true
xdg-icon-resource forceupdate 2>/dev/null || true

echo "==> Installazione .desktop ..."
mkdir -p "$DESKTOP_DIR"
# Desktop Exec requires quoting independently of shell quoting. Escape command
# characters first, then desktop-entry backslashes; %% is a literal percent.
EXEC_PATH="$INSTALL_DIR/adomnia"
EXEC_PATH="${EXEC_PATH//\\/\\\\}"
EXEC_PATH="${EXEC_PATH//\"/\\\"}"
EXEC_PATH="${EXEC_PATH//\`/\\\`}"
EXEC_PATH="${EXEC_PATH//\$/\\\$}"
EXEC_PATH="${EXEC_PATH//\\/\\\\}"
EXEC_PATH="${EXEC_PATH//%/%%}"
while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
        Exec=*) printf 'Exec="%s"\n' "$EXEC_PATH" ;;
        *) printf '%s\n' "$line" ;;
    esac
done < "$SCRIPT_DIR/adomnia.desktop" > "$DESKTOP_DIR/adomnia.desktop"
chmod 644 "$DESKTOP_DIR/adomnia.desktop"
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

echo ""
echo "Installazione completata. Avvia adOmnia dal launcher o con:"
echo "  $INSTALL_DIR/adomnia"
echo "Dati e impostazioni esistenti non sono stati modificati."
if [ -e /opt/adomnia/adomnia ]; then
    echo "La vecchia installazione in /opt/adomnia è rimasta intatta."
    echo "Dopo aver verificato questa copia, rimuovila con il vecchio uninstall.sh (sudo)."
fi
