#!/usr/bin/env bash
# generate-icons.sh - regenerate app icons from the production source PNG.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${SOURCE_ICON:-$ROOT/assets/images/icon.png}"

if [[ ! -f "$SRC" && -f "$ROOT/build/appicon.png" ]]; then
  SRC="$ROOT/build/appicon.png"
fi

if [[ ! -f "$SRC" ]]; then
  echo "SKIP  Source icon not found: $SRC"
  exit 0
fi

if ! command -v convert &>/dev/null && ! command -v magick &>/dev/null; then
  echo "SKIP  ImageMagick not installed - using existing icons"
  echo "      macOS:  brew install imagemagick"
  echo "      Linux:  sudo apt-get install imagemagick"
  exit 0
fi

CONVERT="$(command -v magick 2>/dev/null || command -v convert)"
ICO="$ROOT/build/windows/icon.ico"
APPICON="$ROOT/build/appicon.png"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

mkdir -p "$ROOT/build/windows" "$ROOT/assets/icons/linux"

echo "-> Generating app icons from $SRC..."
"$CONVERT" "$SRC" -resize 512x512 "$APPICON"

sizes=(16 24 32 48 64 128 256)
ico_inputs=()
for size in "${sizes[@]}"; do
  out="$TMPDIR/icon_${size}.png"
  "$CONVERT" "$SRC" -resize "${size}x${size}" "$out"
  ico_inputs+=("$out")
done
"$CONVERT" "${ico_inputs[@]}" "$ICO"
echo "OK  $ICO generated"

for size in 16 24 32 48 64 128 256 512; do
  "$CONVERT" "$SRC" -resize "${size}x${size}" "$ROOT/assets/icons/linux/adOmnia_${size}x${size}.png"
done
echo "OK  Linux icon set generated"
