#!/usr/bin/env bash
# generate-icons.sh — regenerate app icons from build/appicon.png
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/build/appicon.png"

if [[ ! -f "$SRC" ]]; then
  echo "SKIP  $SRC not found"; exit 0
fi

if ! command -v convert &>/dev/null && ! command -v magick &>/dev/null; then
  echo "SKIP  ImageMagick not installed — using existing icons"
  echo "      macOS:  brew install imagemagick"
  echo "      Linux:  sudo apt-get install imagemagick"
  exit 0
fi

CONVERT=$(command -v magick 2>/dev/null || command -v convert)
ICO="$ROOT/build/windows/icon.ico"

echo "→ Generating $ICO from $SRC..."
"$CONVERT" "$SRC" -resize 256x256 "$ICO" 2>/dev/null && echo "OK  icon.ico generated" || echo "WARN  icon generation failed"
