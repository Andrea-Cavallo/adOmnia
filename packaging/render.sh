#!/usr/bin/env bash
# Render the package-manager manifests for a specific version.
# Downloads the release assets, computes SHA-256 checksums, and writes the
# finished manifests into ./out so they can be dropped into the Scoop bucket
# and the Homebrew tap. Requires curl + sha256sum (Git Bash / WSL / Linux / macOS).
#
# Usage:  bash packaging/render.sh 0.9.65
set -euo pipefail

VERSION="${1:?Usage: render.sh <version>}"
OWNER="Andrea-Cavallo"
REPO="adOmnia"
BASE="https://github.com/${OWNER}/${REPO}/releases/download/v${VERSION}"

mkdir -p dist out

for asset in \
  "adomnia-${VERSION}-windows-amd64.exe" \
  "adomnia-${VERSION}-linux-amd64-gtk3-webkitgtk-4.1.tar.gz" \
  "adomnia-${VERSION}-macos-universal.dmg"; do
  if [ ! -f "dist/${asset}" ]; then
    curl -fL -o "dist/${asset}" "${BASE}/${asset}"
  fi
done

W="$(sha256sum "dist/adomnia-${VERSION}-windows-amd64.exe" | cut -d' ' -f1)"
L="$(sha256sum "dist/adomnia-${VERSION}-linux-amd64-gtk3-webkitgtk-4.1.tar.gz" | cut -d' ' -f1)"
M="$(sha256sum "dist/adomnia-${VERSION}-macos-universal.dmg" | cut -d' ' -f1)"

sed -e "s/__VERSION__/${VERSION}/g" -e "s/__SHA256_WINDOWS__/sha256:${W}/g" \
  packaging/scoop/adomnia.json > out/adomnia.json

sed -e "s/__VERSION__/${VERSION}/g" -e "s/__SHA256_MACOS__/${M}/g" \
  packaging/homebrew/Casks/adomnia.rb > out/Casks-adomnia.rb

sed -e "s/__VERSION__/${VERSION}/g" -e "s/__SHA256_LINUX__/${L}/g" \
  packaging/homebrew/Formula/adomnia.rb > out/Formula-adomnia.rb

sed -e "s/__VERSION__/${VERSION}/g" -e "s/__SHA256_LINUX__/${L}/g" \
  packaging/snap/snapcraft.yaml > out/snapcraft.yaml

sed -e "s/__VERSION__/${VERSION}/g" -e "s/__SHA256_LINUX__/${L}/g" \
  packaging/flatpak/com.adomnia.app.yml > out/com.adomnia.app.yml

echo "Rendered manifests into ./out:"
ls -l out
