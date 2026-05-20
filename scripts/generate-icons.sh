#!/usr/bin/env bash
# scripts/generate-icons.sh
# Generates all icon assets from the source PNG before any build step.
#
# ICON SOURCE — to update the app icon, replace this file:
#   assets/images/logoExe.png
#
# OUTPUTS:
#   build/appicon.png              Wails runtime icon (512x512)
#   build/windows/icon.ico         Windows .exe icon (16/24/32/48/64/128/256)
#   assets/icons/linux/*.png       Linux desktop icon sizes
#
# Usage:
#   ./scripts/generate-icons.sh
#   ./scripts/generate-icons.sh path/to/custom-icon.png

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'

SOURCE_ICON="${1:-assets/images/logoExe.png}"

# ── Locate ImageMagick ──────────────────────────────────────────────────────────
MAGICK=""
if command -v magick &>/dev/null; then
    MAGICK="magick"
elif command -v convert &>/dev/null; then
    MAGICK="convert"
else
    echo -e "${RED}ERROR: ImageMagick not found in PATH.${NC}"
    echo ""
    echo -e "  ${YELLOW}Ubuntu/Debian:${NC}  sudo apt-get install imagemagick"
    echo -e "  ${YELLOW}Fedora:${NC}         sudo dnf install imagemagick"
    echo -e "  ${YELLOW}Arch:${NC}           sudo pacman -S imagemagick"
    echo -e "  ${YELLOW}macOS:${NC}          brew install imagemagick"
    echo ""
    exit 1
fi

# ── Validate source ─────────────────────────────────────────────────────────────
if [ ! -f "$SOURCE_ICON" ]; then
    echo -e "${RED}ERROR: Source icon not found: $SOURCE_ICON${NC}"
    echo -e "  Place the production 1024x1024 PNG at: ${YELLOW}$SOURCE_ICON${NC}"
    exit 1
fi

echo -e "    ${GRAY}Source : $SOURCE_ICON${NC}"

# ── Step 1: Windows .ico ────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}==> Generating Windows icon ...${NC}"
mkdir -p build/windows

TMPDIR_ICONS=$(mktemp -d)
trap 'rm -rf "$TMPDIR_ICONS"' EXIT

ICO_INPUTS=()
for sz in 16 24 32 48 64 128 256; do
    TMP="$TMPDIR_ICONS/icon_${sz}.png"
    $MAGICK "$SOURCE_ICON" -resize "${sz}x${sz}" -filter Lanczos "$TMP"
    ICO_INPUTS+=("$TMP")
done

$MAGICK "${ICO_INPUTS[@]}" build/windows/icon.ico
echo -e "${GREEN}    build/windows/icon.ico  (sizes: 16 24 32 48 64 128 256)${NC}"

# ── Step 2: Wails runtime icon ──────────────────────────────────────────────────
echo ""
echo -e "${CYAN}==> Applying executable icon (Wails appicon) ...${NC}"
$MAGICK "$SOURCE_ICON" -resize "512x512" -filter Lanczos build/appicon.png
echo -e "${GREEN}    build/appicon.png  (512x512)${NC}"

# ── Step 3: Linux icon sizes ────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}==> Generating Linux icons ...${NC}"
mkdir -p assets/icons/linux

for sz in 16 24 32 48 64 128 256 512; do
    OUT="assets/icons/linux/adOmnia_${sz}x${sz}.png"
    $MAGICK "$SOURCE_ICON" -resize "${sz}x${sz}" -filter Lanczos "$OUT"
    echo -e "${GREEN}    $OUT${NC}"
done

echo ""
echo -e "${GREEN}==> Icon generation complete.${NC}"
echo ""
